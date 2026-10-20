// The turri engine: a Node process - Electron's own, run as Node - that hosts turri's chat for one project: pi's agent
// session with turri's extension, from the @turri-dev/cli package's host entry. It talks to the Electron main process
// over IPC. The chat's job registry and work loop are the project's one: the window's buttons go through the chat's
// slash commands, and what its jobs do is sent to the window as they do it. The app never shells out to `turri`.
import turri, { turriFrom } from "./turri.mjs";
import { startChat } from "./chat.mjs";
import { existsSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

// turri writes progress to the console as it would to a terminal; here it is only a log line for the app.
for (const level of ["log", "info", "warn", "error"]) {
  console[level] = (...args) => emit("log", { level, text: args.map(String).join(" ") });
}

function emit(event, data) {
  process.send?.({ event, data });
}

let projectDir;
/** The chat's job registry and work loop, once its extension has made them - the loop only once work is first asked for. */
let registry;
let loop;
/** A loop of the engine's own that starts nothing: what is left to regenerate, read without the chat's. */
let looker;
let chat;
const questions = new Map();
let nextQuestion = 0;
/** turri's browser and terminal tools' requests of the preview, waiting for the main process to answer. */
const paneCalls = new Map();
let nextPaneCall = 0;
/** What the person has open in the window - its view, and the file in it - for turri to know (engine/app.mjs). */
let looking = { view: "spec", file: null, pane: null };

/** What turri's chat tells its host - the window - of its jobs and its work loop (TurriHost in turri). */
const ENDED = new Set(["succeeded", "failed", "stopped"]);
const announced = new Set();
const host = {
  onJobs: (made) => (registry = made),
  onWorkLoop: (made) => {
    loop = made;
    emit("status", statusNow());
  },
  onJobChange: (job) => {
    const ended = ENDED.has(job.status);
    jobChanged(job, ended);
    if (!ended || announced.has(job.id)) return;
    announced.add(job.id);
    if (job.replacedBy === undefined) emit("finished", { id: job.id, status: job.status, title: job.title ?? job.summary, module: job.module });
    emit("status", statusNow());
    readEarlier();
  },
  onPlanChange: () => emit("status", statusNow()),
  // ask_user's questions, put in the window: a choice of options, or words to type.
  dialogs: {
    select: (title, options, context) => ask({ kind: "select", title, options, message: context }),
    input: (title, context) => ask({ kind: "input", title, message: context }),
  },
};

// ---------- the project ----------

async function open({ dir }) {
  projectDir = resolve(dir);
  process.chdir(projectDir);
  const orphans = turri.sweepOrphanedGroups();
  looker = turri.createWorkLoop({ registry: turri.createJobRegistry(), cwd: projectDir, dryRun: true });
  turri.onModelEvent((event) => {
    const line = turri.describeTurnIncident(event);
    if (line !== undefined) emit("incident", { job: event.job, text: line });
  });
  stopHearing();
  stopHearing = turri.onLedgerEvent?.(heard) ?? (() => {});
  await chatAnew();
  watchSpecs();
  readEarlier();
  return { ...summary(), orphans, chatModel: chat.model() };
}

// ---------- the ledger: what turri did, as facts ----------

// turri records what it does in the project's ledger (.turri/ledger/, turri's docs/hosting.md) on its own. The window
// shows it - the pulses of earlier sessions, and a failure the work goes on past - and never decides anything from it:
// what is running and planned is the registry's and the work loop's. A turri with no ledger (0.1.x) shows none of it.

let stopHearing = () => {};
/** The failures said of each pulse, by its id: each said once, however often it happens - and a mark on its card. */
const failures = new Map();
/** The project's earlier pulses, as the ledger has them: read as it opens and as each pulse ends, never on each event. */
let earlier = [];
/** Runs sent to the window: it shows the last few, and more on asking. */
const EARLIER_RUNS = 40;

/** A failure the person is to hear of, as it happens: a healer failing, the model provider for good, landed work not committed. */
function failureOf(entry) {
  if (entry.kind === "healer.failed") return { mark: `the ${entry.healer} failed`, text: `the ${entry.healer} failed: ${entry.error}` };
  if (entry.kind === "provider.error" && !entry.transient) return { mark: "the model provider failed", text: `the model provider failed: ${entry.error}` };
  if (entry.kind === "history.failed" && entry.landing) return { mark: "not committed", text: `the pulse's work could not be committed, so it does not land: ${entry.said}` };
  return undefined;
}

/** Each event as turri records it: a failure is said in the window - once a pulse - and marked on the pulse's card. */
function heard(entry, project) {
  if (resolve(project) !== projectDir) return;
  const failure = failureOf(entry);
  if (failure === undefined) return;
  const key = entry.job ?? `run ${entry.run}`;
  const said = failures.get(key) ?? [];
  if (said.some((one) => one.mark === failure.mark)) return;
  failures.set(key, [...said, failure]);
  const job = entry.job !== undefined ? registry?.get(entry.job) : undefined;
  const name = job !== undefined ? pulseName(job) : undefined;
  emit("incident", { job: entry.job, text: name !== undefined ? `${name}: ${failure.text}` : failure.text });
  if (job !== undefined) jobChanged(job, true);
}

function pulseName(job) {
  if (job.module === undefined) return job.title ?? job.summary;
  return job.pulse !== undefined ? `${job.module} · pulse ${job.pulse}` : `${job.module} ${job.kind}`;
}

/**
 * The project's runs and their pulses, the most recent first - but for this session's, which the window has live - each
 * a plain object, as the window is sent it.
 */
function readEarlier() {
  if (turri.runViews === undefined) return;
  const live = new Set((registry?.list() ?? []).map((job) => job.id));
  let runs;
  let failed;
  try {
    runs = turri.runViews(projectDir);
    failed = turri.readLedger(projectDir, { kinds: ["healer.failed", "provider.error", "history.failed"] });
  } catch (error) {
    emit("log", { level: "error", text: `the ledger could not be read: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  const marks = new Map();
  for (const entry of failed) {
    const failure = entry.job !== undefined ? failureOf(entry) : undefined;
    if (failure === undefined) continue;
    const own = marks.get(entry.job) ?? [];
    if (!own.some((one) => one.mark === failure.mark)) marks.set(entry.job, [...own, failure]);
  }
  earlier = runs
    .map((view) => ({
      run: view.run,
      mode: view.started?.mode ?? null,
      started: view.started?.ts ?? view.pulses[0]?.queued?.ts ?? null,
      version: view.started?.version ?? null,
      pulses: view.pulses.filter((pulse) => !live.has(pulse.id)).map((pulse) => pastPulse(pulse, marks.get(pulse.id) ?? [])),
    }))
    .filter((run) => run.pulses.length > 0)
    .slice(0, EARLIER_RUNS);
  emit("earlier", earlier);
}

/** A pulse of an earlier session, as its card says it: what it was, how it ended, how long it ran, what it cost. */
function pastPulse(view, failed) {
  const { queued, started, finished } = view;
  return {
    id: view.id,
    run: view.run,
    kind: queued?.jobKind ?? "regenerate",
    summary: queued?.summary ?? view.id,
    module: queued?.module ?? null,
    pulse: queued?.pulse ?? null,
    title: queued?.title ?? null,
    // Never ended: its run stopped - quit, killed - while it ran, or before it started.
    status: finished?.status ?? (started !== undefined ? "unended" : "unstarted"),
    landed: finished?.landed ?? null,
    stoppedBy: finished?.stoppedBy ?? null,
    ms: finished?.ms ?? null,
    usage: finished?.usage ?? null,
    error: finished?.error ?? null,
    failures: failed,
  };
}

function earlierPulses() {
  return earlier;
}

/** One earlier pulse, opened: what `turri ledger <pulse>` says of it, and its log, when it is still there. */
function pastPulseDetail({ id, run }) {
  const view = turri.pulseView(id, turri.readLedger(projectDir, { run }));
  if (view === undefined) throw new Error(`The ledger has nothing of pulse ${id} now.`);
  const named = view.finished?.logFile ?? view.started?.logFile;
  const log = named !== undefined ? resolve(projectDir, named) : undefined;
  return { lines: turri.describePulseView(view).split("\n"), log: log !== undefined && existsSync(log) ? log : null };
}

/**
 * The project's files change under the window too - turri edits the specs from the chat, a pulse writes code - and the
 * window is told. A .plain file comes with its text and what it now says; a save of the window's own comes back the
 * same way, and is known by its text. Any other change is only where it was, for the tree to list that folder again.
 * A module's history moving - a pulse landing, its code deleted to regenerate it from scratch - changes what each spec
 * has built and conformance tested, though no spec changed: every spec is sent again, with what it has now.
 */
function watchSpecs() {
  const skip = new Set([turri.MODULES_DIR, "node_modules", ".git", ".turri", "dist"]);
  const pending = new Map();
  const changed = new Set();
  let filesTimer;
  let configTimer;
  let historyTimer;
  watch(projectDir, { recursive: true }, (_type, name) => {
    if (name === null) return;
    const parts = name.split(sep);
    if (parts[0] === turri.MODULES_DIR && parts.includes(".plaingit") && (parts.at(-1) === "HEAD" || parts.includes("refs"))) {
      clearTimeout(historyTimer);
      historyTimer = setTimeout(() => {
        for (const file of plainFiles(projectDir)) emit("spec", { file, text: readFileSync(file, "utf8"), spec: describeSpec(file) });
      }, 300);
    }
    // The project's config - /turri-config writes it from the chat: the window shows its settings again.
    if (CONFIG_FILE.test(name)) {
      clearTimeout(configTimer);
      configTimer = setTimeout(() => emit("config", null), 250);
    }
    if (!parts.some((part) => UNLISTED.has(part))) {
      changed.add(join(projectDir, name));
      clearTimeout(filesTimer);
      filesTimer = setTimeout(() => {
        emit("files", { paths: [...changed] });
        changed.clear();
      }, 250);
    }
    if (!name.endsWith(".plain") || parts.some((part) => skip.has(part) || part.startsWith("."))) return;
    const file = join(projectDir, name);
    // An editor writes a file in more than one step: it is read once they have settled.
    clearTimeout(pending.get(file));
    pending.set(
      file,
      setTimeout(() => {
        pending.delete(file);
        if (!existsSync(file)) return;
        emit("spec", { file, text: readFileSync(file, "utf8"), spec: describeSpec(file) });
      }, 150),
    );
  });
}

// ---------- the project's files ----------

/** The project's config at its root: config.turri.yaml, a stack's config.turri.<stack>.yaml, or the older config.yaml. */
const CONFIG_FILE = /^config(\.turri(\.[^./\\]+)?)?\.yaml$/;

/** What the tree leaves out: version control's own, installed packages and caches nobody reads. */
const UNLISTED = new Set([".git", ".plaingit", "node_modules", ".venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".DS_Store"]);
/** A file larger than this is offered to open elsewhere, not read into the window. */
const READABLE_SIZE = 1024 * 1024;

/** A path the window names, held to the project: nothing outside it is listed, read or written. */
function inProject(path) {
  const full = resolve(projectDir, path);
  if (full !== projectDir && !full.startsWith(projectDir + sep)) throw new Error(`Not in the project: ${path}`);
  return full;
}

/** One folder of the project, folders first: the tree lists a folder when it is opened. Null for one not there (any more). */
function listFiles({ dir }) {
  const at = inProject(dir ?? projectDir);
  if (!existsSync(at) || !statSync(at).isDirectory()) return null;
  const entries = readdirSync(at, { withFileTypes: true })
    .filter((entry) => !UNLISTED.has(entry.name) && (entry.isDirectory() || entry.isFile()))
    .map((entry) => ({ name: entry.name, path: join(at, entry.name), dir: entry.isDirectory() }));
  return entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

/** A file's text - or, for one that is not text or too large to read here, why not. */
function readFile({ file }) {
  const full = inProject(file);
  const { size } = statSync(full);
  if (size > READABLE_SIZE) return { file: full, text: null, reason: "large", size };
  const bytes = readFileSync(full);
  if (bytes.subarray(0, 8000).includes(0)) return { file: full, text: null, reason: "binary", size };
  return { file: full, text: bytes.toString("utf8"), size };
}

function writeFile({ file, text }) {
  writeFileSync(inProject(file), text);
  return true;
}

// ---------- a new project ----------

/** turri's vendors and the two models each gives - and Bedrock's, by maker and geography - for the window to choose from. */
function vendors() {
  const bedrockModels = {};
  for (const [maker, regions] of Object.entries(turri.BEDROCK_REGIONS)) {
    for (const region of regions) bedrockModels[`${maker}/${region}`] = turri.bedrockModels({ maker, region });
  }
  return {
    vendors: Object.entries(turri.VENDORS).map(([id, preset]) => ({ id, label: preset.label, harness: preset.harness, coding: preset.coding })),
    regions: turri.BEDROCK_REGIONS,
    bedrockDefault: turri.BEDROCK_DEFAULT,
    bedrockModels,
  };
}

/**
 * A new project's config.turri.yaml, as `turri init-config` writes it, with the chosen vendor's models. What turri says
 * of it is kept up to its terminal advice - the commands to run next - which a window has no use for.
 */
function initConfig({ dir, vendor, bedrock }) {
  const { message } = turri.initConfig(dir, { vendor, ...(bedrock !== undefined ? { bedrock } : {}) });
  const lines = message.split("\n");
  const then = lines.findIndex((line) => line.trim() === "Then");
  return { message: (then === -1 ? lines : lines.slice(0, then)).join("\n").trim() };
}

/** A question for the person, put in the window; answered through `answer`. */
function ask(question) {
  const id = ++nextQuestion;
  return new Promise((resolve) => {
    questions.set(id, resolve);
    emit("chat:ask", { id, ...question });
  });
}

/**
 * One of turri's browser or terminal tools, asked of the window's preview - the main process drives its browser pane
 * and its terminal - and its answer.
 */
const askPane = (pane) => (action, params) => {
  const id = ++nextPaneCall;
  return new Promise((resolve, reject) => {
    paneCalls.set(id, { resolve, reject });
    process.send?.({ [pane]: action, id, params });
  });
};
const browser = askPane("browser");
const terminal = askPane("terminal");

function answer({ id, value }) {
  questions.get(id)?.(value ?? undefined);
  questions.delete(id);
  return true;
}

function summary() {
  const project = turri.readProjectConfig(projectDir);
  const models = turri.projectModels(project);
  return {
    dir: projectDir,
    name: basename(projectDir),
    hasConfig: turri.hasProjectConfig(projectDir),
    stacks: turri.stacksOf(projectDir),
    settings: {
      "harness-model": turri.modelSpec(models.harness) ?? null,
      "coding-model": turri.modelSpec(models.coding) ?? null,
      "conformance-tests": String(project.conformanceTests ?? false),
      review: project.review === true,
      "parallel-jobs": project.parallelJobs ?? turri.defaultParallelJobs(),
      // As turri has it - TURRI_DEBUG over the file's - where the turri running has a debug mode at all.
      ...(turri.debugMode !== undefined ? { debug: turri.debugMode(projectDir) } : {}),
    },
    specs: plainFiles(projectDir).map((file) => describeSpec(file)),
  };
}

/** Every .plain file of the project, outside plain_modules and the folders nobody writes specs in. */
function plainFiles(dir) {
  const skip = new Set([turri.MODULES_DIR, "node_modules", ".git", ".turri", "dist", "template", "resources"]);
  const found = [];
  const walk = (at, depth) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
      const path = join(at, entry.name);
      if (entry.isDirectory() && depth < 3) walk(path, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".plain")) found.push(path);
    }
  };
  walk(dir, 0);
  return found.sort();
}

function describeSpec(file) {
  const result = turri.checkPlainFile(file);
  const text = readFileSync(file, "utf8");
  const description = /^description:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const base = { file, rel: relative(projectDir, file), ok: result.ok, module: result.moduleName ?? basename(file, ".plain"), description, requires: result.requiredModules ?? [] };
  if (!result.ok) return { ...base, error: result.error, functionalSpecs: [] };
  // A functional spec is completed when the codebase the chain delivers has it, as the spec has it now.
  let incomplete;
  let conformanceTested = 0;
  // The functional specs whose conformance tests are written and pass, as the spec has them now, by number.
  let tested = new Set();
  let built = false;
  try {
    for (const chain of turri.functionalityCompletion(file)) {
      const own = chain.modules.find((entry) => entry.module === result.moduleName);
      if (own === undefined) continue;
      incomplete = new Set(own.incomplete);
      built = own.completed > 0;
      conformanceTested = own.conformanceTested;
      tested = new Set(own.tested);
    }
  } catch {
    /* nothing built, or a chain that does not resolve: every spec is still to build */
  }
  const functionalSpecs = [];
  try {
    const [, tree] = turri.plainFileParser(basename(file), turri.resolveTemplateDirs(file), { allowNoFunctionalities: true });
    for (const { frid, specifications } of turri.iterateFunctionalSpecs(tree, false)) {
      const own = specifications[turri.FUNCTIONAL_REQUIREMENTS]?.at(-1) ?? "";
      const built = incomplete !== undefined ? !incomplete.has(frid) : false;
      functionalSpecs.push({ frid, text: own.replace(/^- /, ""), built, conformed: built && tested.has(frid) });
    }
  } catch (error) {
    return { ...base, ok: false, error: error instanceof Error ? error.message : String(error), functionalSpecs: [] };
  }
  // Whether its code is regenerated from the spec as it is now: what the Regenerate button would have to do.
  let drifted = false;
  try {
    drifted = looker.drift(file).some((report) => report.code !== null);
  } catch {
    drifted = true;
  }
  return { ...base, built, drifted, conformanceTested, functionalSpecs };
}

function readSpec({ file }) {
  return { file, text: readFileSync(file, "utf8") };
}

function writeSpec({ file, text }) {
  writeFileSync(file, text);
  const described = describeSpec(file);
  // A spec that changes while the chat's loop looks after its module is work: the loop is told, as the chat's watch does.
  if (described.ok && loop !== undefined && loop.status().some((status) => status.plainFile === file)) {
    loop.bringUp(file, { specChange: true }).then(() => emit("status", statusNow())).catch((error) => emit("log", { level: "error", text: String(error) }));
  }
  return described;
}

/**
 * The spec's lines as turri's own ***plain grammar colours them - the same roles the TUI uses. The front matter's
 * values have none of their own, and would read as the text around them: they are `meta`, its fences `bullet`, and
 * an item of its lists - a module it imports or requires - is a `module` whole, not only up to its first `/`.
 */
function highlightSpec({ text }) {
  return turri.highlightLines(text.split("\n")).map((tokens) => {
    const line = tokens.map((token) => token.text).join("");
    const item = /^(\s*-\s+)(\S.*)$/.exec(line);
    const inFrontMatter = tokens.length > 0 && tokens.every((token) => token.scopes.includes("meta.frontmatter.plain"));
    if (inFrontMatter && item !== null && !tokens.some((token) => turri.roleOf(token.scopes) === "concept")) {
      return [{ text: item[1], role: "bullet" }, { text: item[2], role: "module" }];
    }
    return tokens.map((token) => ({ text: token.text, role: roleOf(token) }));
  });
}

function roleOf({ text, scopes }) {
  const role = turri.roleOf(scopes) ?? null;
  if (!scopes.includes("meta.frontmatter.plain")) return role;
  if (text === "---") return "bullet";
  return role === "keyword" || role === "concept" ? role : "meta";
}

// ---------- the work ----------

function statusNow() {
  return {
    modules: loop?.status() ?? [],
    jobs: (registry?.list() ?? []).filter((job) => job.replacedBy === undefined).map(jobView),
    planned: (loop?.planned() ?? []).map(jobView),
  };
}

/** A job as the app shows it: everything but its transcript, which is fetched when it is opened. */
function jobView(job) {
  const { transcript, tail, details, ...rest } = job;
  return { ...rest, transcriptLength: transcript?.length ?? 0, specGaps: details?.specGaps ?? [], failures: failures.get(job.id) ?? [] };
}

const lastSent = new Map();
function jobChanged(job, now = false) {
  // A job reports many times a second while its agent streams: the window gets it at most five times a second.
  const at = Date.now();
  if (!now && at - (lastSent.get(job.id) ?? 0) < 200) return;
  lastSent.set(job.id, at);
  emit("job", jobView(job));
}

// The buttons say what the person would type: the chat's own commands run them, on its one work loop.

/**
 * /regenerate, as the window chose it: what changed, named functional specs again, or from scratch - its whole chain
 * too - and how to cut the work in the person's words. turri reads the words after the module: numbers first are
 * functional specs, "from scratch" and "whole chain" say so, the rest is guidance.
 */
function regenerate({ file, frids, scratch, chain, guidance }) {
  const words = [`/regenerate ${relative(projectDir, file)}`];
  if (scratch) words.push(chain ? "from scratch, the whole chain" : "from scratch");
  else if (frids?.length) words.push(frids.join(" "));
  // Set off from what comes before it - and never read as a functional spec's number, though it starts with one.
  const said = guidance?.trim();
  if (said) words.push(words.length > 1 || /^(fs)?\d/i.test(said) ? `- ${said}` : said);
  chat.send(words.join(" "));
  return true;
}

function conform({ file, frids }) {
  const module = basename(file, ".plain");
  chat.send(frids?.length ? `Write and run the conformance tests for ${module}'s functional spec${frids.length === 1 ? "" : "s"} ${frids.join(", ")}.` : `Write and run the conformance tests for ${module}.`);
  return true;
}

function release({ file }) {
  chat.send(
    `Release ${relative(projectDir, file)} for me to try. Once it runs, open it in the preview where I can watch - the terminal or the browser, whichever suits what it is - and check it starts. Then tell me how to open or run it, and what to test: what was built from the spec, and for each the steps to check it works and what I should see.`,
  );
  return true;
}

/**
 * The window's view and the file open in it - or, in the preview, its browser or terminal - as the person moves about:
 * told to turri at its next turn.
 */
function look({ view, file, pane }) {
  looking = { view, file: file ? relative(projectDir, file) || file : null, pane: pane ?? null };
  return true;
}

function sendChat({ text }) {
  chat.send(text);
  return true;
}

function abortChat() {
  void chat.abort();
  return true;
}

function commands() {
  return chat.commands();
}

function chatHistory() {
  return { messages: chat.history(), model: chat.model(), stats: chat.stats() };
}

/** The conversation, started: a session of its own, with turri's extension and its job registry and work loop made for it. */
async function chatAnew() {
  const harnessModel = turri.modelSpec(turri.projectModels(turri.readProjectConfig(projectDir)).harness);
  // The work loop's plan can change with no word of it - planned again while a pulse runs, on a spec edited from the
  // chat - so the window is sent it again as each of the chat's tools ends, and as it settles: regenerate, say, ends
  // once the plan is made.
  chat = await startChat({ cwd: projectDir, harnessModel, host, emit, ask, browser, terminal, whereNow: () => looking, onStep: () => loop !== undefined && emit("status", statusNow()) });
}

/**
 * A new session: the conversation started over, nothing of this one carried into it - as /new is in the terminal. Not
 * while pulses run: they are the work loop's that goes with this conversation, and would run on with no one to follow
 * them.
 */
async function newChat() {
  const running = (registry?.list() ?? []).filter((job) => job.status === "running" || job.status === "queued");
  if (running.length > 0) throw new Error(`${running.length} pulse${running.length === 1 ? " is" : "s are"} running: start a new session once ${running.length === 1 ? "it has" : "they have"} finished.`);
  for (const resolve of questions.values()) resolve(undefined);
  questions.clear();
  chat.abort();
  chat.dispose();
  registry = undefined;
  loop = undefined;
  await chatAnew();
  emit("status", statusNow());
  // The last session's pulses are an earlier session's now.
  readEarlier();
  return { messages: chat.history(), model: chat.model(), stats: chat.stats() };
}

/** What regenerating would do, planned on a loop of its own that starts nothing - `turri glimpse`. */
async function glimpse({ file }) {
  const project = turri.readProjectConfig(projectDir);
  const models = turri.projectModels(project);
  const planner = turri.modelSpec(models.harness);
  const dry = turri.createWorkLoop({
    registry: turri.createJobRegistry(),
    cwd: projectDir,
    dryRun: true,
    modelFor: () => turri.modelSpec(models.coding),
    ...(planner !== undefined ? { plannerModel: planner } : {}),
  });
  const statuses = await dry.bringUp(file);
  const firsts = [];
  for (const first of dry.firsts()) {
    firsts.push({ module: first.module, title: first.planned.title, reason: first.planned.reason, track: first.planned.track, prompt: first.planned.track === "code" ? ((await turri.promptOf(first)) ?? null) : null });
  }
  return { statuses, firsts, drift: dry.drift(file) };
}

function transcript({ id }) {
  return registry?.get(id)?.transcript ?? [];
}

// ---------- the wire ----------

const methods = { newChat, look, open, vendors, initConfig, summary, listFiles, readFile, writeFile, readSpec, writeSpec, highlightSpec, status: statusNow, regenerate, conform, release, glimpse, transcript, earlierPulses, pastPulseDetail, sendChat, abortChat, chatHistory, commands, answer };

// What the window may ask before a project is open: to open one, or to start a new one.
const BEFORE_A_PROJECT = new Set(["open", "vendors", "initConfig"]);

// The app gone - quit, crashed, killed - the engine goes with it: never a chat left running with no window.
process.on("disconnect", () => {
  stopHearing();
  process.exit(0);
});

process.on("message", async ({ id, method, params, reply, result, error }) => {
  if (reply !== undefined) {
    const call = paneCalls.get(reply);
    paneCalls.delete(reply);
    if (error !== undefined) call?.reject(new Error(error));
    else call?.resolve(result);
    return;
  }
  try {
    const handler = methods[method];
    if (handler === undefined) throw new Error(`No such engine method: ${method}`);
    if (!BEFORE_A_PROJECT.has(method) && projectDir === undefined) throw new Error("No project is open.");
    const result = await handler(params ?? {});
    process.send?.({ id, result });
  } catch (error) {
    process.send?.({ id, error: error instanceof Error ? error.message : String(error) });
  }
});

emit("ready", { node: process.version, turri: turriFrom });
