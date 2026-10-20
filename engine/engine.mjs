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
const browserCalls = new Map();
let nextBrowserCall = 0;
/** What the person has open in the window - its view, and the file in it - for turri to know (engine/app.mjs). */
let looking = { view: "spec", file: null };

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
  await chatAnew();
  watchSpecs();
  return { ...summary(), orphans, chatModel: chat.model() };
}

/**
 * The project's files change under the window too - turri edits the specs from the chat, a pulse writes code - and the
 * window is told. A .plain file comes with its text and what it now says; a save of the window's own comes back the
 * same way, and is known by its text. Any other change is only where it was, for the tree to list that folder again.
 */
function watchSpecs() {
  const skip = new Set([turri.MODULES_DIR, "node_modules", ".git", ".turri", "dist"]);
  const pending = new Map();
  const changed = new Set();
  let filesTimer;
  let configTimer;
  watch(projectDir, { recursive: true }, (_type, name) => {
    if (name === null) return;
    // The project's config - /turri-config writes it from the chat: the window shows its settings again.
    if (CONFIG_FILE.test(name)) {
      clearTimeout(configTimer);
      configTimer = setTimeout(() => emit("config", null), 250);
    }
    const parts = name.split(sep);
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

/** One folder of the project, folders first: the tree lists a folder when it is opened. */
function listFiles({ dir }) {
  const at = inProject(dir ?? projectDir);
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

/** One of turri's browser tools, asked of the window's preview pane - the main process drives it - and its answer. */
function browser(action, params) {
  const id = ++nextBrowserCall;
  return new Promise((resolve, reject) => {
    browserCalls.set(id, { resolve, reject });
    process.send?.({ browser: action, id, params });
  });
}

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
  return { ...rest, transcriptLength: transcript?.length ?? 0, specGaps: details?.specGaps ?? [] };
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
    `Release ${relative(projectDir, file)} for me to try. Once it runs, tell me how to open or run it, and what to test: what was built from the spec, and for each the steps to check it works and what I should see.`,
  );
  return true;
}

/** The window's view and the file open in it, as the person moves about: told to turri at its next turn. */
function look({ view, file }) {
  looking = { view, file: file ? relative(projectDir, file) || file : null };
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
  chat = await startChat({ cwd: projectDir, harnessModel, host, emit, ask, browser, whereNow: () => looking, onStep: () => loop !== undefined && emit("status", statusNow()) });
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

const methods = { newChat, look, open, vendors, initConfig, summary, listFiles, readFile, writeFile, readSpec, writeSpec, highlightSpec, status: statusNow, regenerate, conform, release, glimpse, transcript, sendChat, abortChat, chatHistory, commands, answer };

// What the window may ask before a project is open: to open one, or to start a new one.
const BEFORE_A_PROJECT = new Set(["open", "vendors", "initConfig"]);

// The app gone - quit, crashed, killed - the engine goes with it: never a chat left running with no window.
process.on("disconnect", () => process.exit(0));

process.on("message", async ({ id, method, params, browserReply, result, error }) => {
  if (browserReply !== undefined) {
    const call = browserCalls.get(browserReply);
    browserCalls.delete(browserReply);
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
