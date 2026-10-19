// The turri engine: a Node process - Electron's own, run as Node - that hosts turri's chat for one project: pi's agent
// session with turri's extension, from the @turri-dev/cli package's host entry. It talks to the Electron main process
// over IPC. The chat's job registry and work loop are the project's one: the window's buttons go through the chat's
// slash commands, and what its jobs do is sent to the window as they do it. The app never shells out to `turri`.
import * as turri from "@turri-dev/cli/host";
import { startChat } from "./chat.mjs";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

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
  const harnessModel = turri.modelSpec(turri.projectModels(turri.readProjectConfig(projectDir)).harness);
  chat = await startChat({ cwd: projectDir, harnessModel, host, emit, ask });
  return { ...summary(), orphans, chatModel: chat.model() };
}

/** A question for the person, put in the window; answered through `answer`. */
function ask(question) {
  const id = ++nextQuestion;
  return new Promise((resolve) => {
    questions.set(id, resolve);
    emit("chat:ask", { id, ...question });
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
  let built = false;
  try {
    for (const chain of turri.functionalityCompletion(file)) {
      const own = chain.modules.find((entry) => entry.module === result.moduleName);
      if (own === undefined) continue;
      incomplete = new Set(own.incomplete);
      built = own.completed > 0;
      conformanceTested = own.conformanceTested;
    }
  } catch {
    /* nothing built, or a chain that does not resolve: every spec is still to build */
  }
  const functionalSpecs = [];
  try {
    const [, tree] = turri.plainFileParser(basename(file), turri.resolveTemplateDirs(file), { allowNoFunctionalities: true });
    for (const { frid, specifications } of turri.iterateFunctionalSpecs(tree, false)) {
      const own = specifications[turri.FUNCTIONAL_REQUIREMENTS]?.at(-1) ?? "";
      functionalSpecs.push({ frid, text: own.replace(/^- /, ""), built: incomplete !== undefined ? !incomplete.has(frid) : false });
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

/** The spec's lines as turri's own ***plain grammar colours them - the same roles the TUI uses. */
function highlightSpec({ text }) {
  return turri.highlightLines(text.split("\n")).map((tokens) => tokens.map((token) => ({ text: token.text, role: turri.roleOf(token.scopes) ?? null })));
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

function regenerate({ file, frids }) {
  chat.send(`/regenerate ${relative(projectDir, file)}${frids?.length ? ` ${frids.join(" ")}` : ""}`);
  return true;
}

function conform({ file, frids }) {
  const module = basename(file, ".plain");
  chat.send(frids?.length ? `Write and run the conformance tests for ${module}'s functional spec${frids.length === 1 ? "" : "s"} ${frids.join(", ")}.` : `Write and run the conformance tests for ${module}.`);
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

function chatHistory() {
  return { messages: chat.history(), model: chat.model() };
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

function stop({ id }) {
  return registry?.stop(id) !== undefined;
}

function halt({ module }) {
  chat.send(`/halt ${module}`);
  return true;
}

function transcript({ id }) {
  return registry?.get(id)?.transcript ?? [];
}

// ---------- the wire ----------

const methods = { open, summary, readSpec, writeSpec, highlightSpec, status: statusNow, regenerate, conform, glimpse, stop, halt, transcript, sendChat, abortChat, chatHistory, answer };

process.on("message", async ({ id, method, params }) => {
  try {
    const handler = methods[method];
    if (handler === undefined) throw new Error(`No such engine method: ${method}`);
    if (method !== "open" && projectDir === undefined) throw new Error("No project is open.");
    const result = await handler(params ?? {});
    process.send?.({ id, result });
  } catch (error) {
    process.send?.({ id, error: error instanceof Error ? error.message : String(error) });
  }
});

emit("ready", { node: process.version });
