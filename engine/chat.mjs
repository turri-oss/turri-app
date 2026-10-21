// The conversation: pi's agent session with turri's extension loaded - the same chat `turri` opens in the terminal, its
// tools, slash commands, rules and skills - with the window in place of the terminal. What the extension would draw in
// the terminal (dialogs, notices, the working line) comes here as UI calls and goes to the window as events.
import turri from "./turri.mjs";
import { browserExtension, retriedWithoutImages } from "./browser.mjs";
import { terminalExtension } from "./terminal.mjs";
import { APP_SURFACE, withWhere } from "./app.mjs";

const { createTurriExtension, pi } = turri;

/**
 * Start a chat in `cwd`. `host` is what turri's extension tells of its jobs and asks its questions in (TurriHost);
 * `emit` sends an event to the window; `ask` puts a question to the person there and resolves with the answer
 * (undefined when they dismiss it); `browser` and `terminal` ask the window's preview - its browser pane, its terminal -
 * for one of the browser or terminal tools' actions; `whereNow` says what the person has open in the window; `onStep`
 * is called as each of its tools ends, and as it settles.
 */
export async function startChat({ cwd, harnessModel, host, emit, ask, browser, terminal, whereNow, onStep }) {
  process.env.PI_SKIP_VERSION_CHECK = "1";

  // The window is told when the conversation's model changes - /turri-config switches it as it runs.
  const modelWatch = (api) => api.on("model_select", ({ model }) => emit("chat:model", { model: `${model.provider}/${model.id}` }));
  const loader = new pi.DefaultResourceLoader({
    cwd,
    agentDir: pi.getAgentDir(),
    // turri is told it is in the app: the window's views in place of the terminal's, and what the person has open now.
    extensionFactories: [
      createTurriExtension({ ...host, surface: APP_SURFACE, systemPrompt: (prompt) => withWhere(prompt, whereNow()) }),
      browserExtension(browser),
      terminalExtension(terminal),
      modelWatch,
    ],
  });
  await loader.reload();
  const { session } = await pi.createAgentSession({ cwd, resourceLoader: loader, sessionManager: pi.SessionManager.create(cwd) });

  // The chat runs on harness-model, as `turri` starts pi with it - and is put on it after a sign-in, when it could not
  // be before.
  let onHarness = false;
  const onHarnessModel = async ({ quiet = true } = {}) => {
    if (!harnessModel || onHarness) return;
    const [spec, level] = splitLevel(harnessModel);
    const slash = spec.indexOf("/");
    const found = slash > 0 ? new pi.ModelRegistry(session.modelRuntime).find(spec.slice(0, slash), spec.slice(slash + 1)) : undefined;
    if (found !== undefined) {
      await session.setModel(found);
      onHarness = true;
    } else if (!quiet) emit("chat:notify", { level: "warning", text: `harness-model ${spec} was not found: the chat uses pi's default model.` });
    if (level && (found !== undefined || !quiet)) session.setThinkingLevel(level);
  };
  await onHarnessModel({ quiet: false });

  // "tui": jobs run in the background and the chat stays free, as in the terminal.
  await session.bindExtensions({
    uiContext: uiContext({ emit, ask }),
    mode: "tui",
    onError: (error) => emit("chat:notify", { level: "error", text: `${error.extensionPath ?? "extension"}: ${error.error ?? error.message ?? error}` }),
  });

  let streaming = null;
  let lastDelta = 0;
  /** How full the conversation's context is, and what it has cost - its own model's calls, not the pulses'. */
  const stats = () => {
    const usage = session.getContextUsage();
    const { cost, tokens } = session.getSessionStats();
    return { percent: usage?.percent ?? null, tokens: usage?.tokens ?? null, contextWindow: usage?.contextWindow ?? null, cost, spent: tokens.total };
  };
  const tellStats = () => emit("chat:stats", stats());
  session.subscribe((event) => {
    switch (event.type) {
      case "agent_start":
        emit("chat:busy", { busy: true });
        break;
      case "agent_settled":
        emit("chat:busy", { busy: false });
        onStep?.();
        tellStats();
        break;
      case "message_update": {
        // The reply as it is written: sent whole, at most ten times a second.
        streaming = event.message;
        const now = Date.now();
        if (now - lastDelta > 100) {
          lastDelta = now;
          emit("chat:streaming", normalise(event.message));
        }
        break;
      }
      case "message_end":
        tellStats();
        streaming = null;
        emit("chat:streaming", null);
        for (const item of [normalise(event.message)].flat()) if (item) emit("chat:message", item);
        break;
      case "tool_execution_start":
        emit("chat:tool", { id: event.toolCallId, name: event.toolName, running: true });
        break;
      case "tool_execution_end":
        emit("chat:tool", { id: event.toolCallId, name: event.toolName, running: false, isError: event.isError === true });
        onStep?.();
        break;
      case "entry_appended": {
        // What the extension puts in the chat outside a turn: a slash command's echo and outcome, a job's announcement.
        const item = entryItem(event.entry);
        if (item) emit("chat:message", item);
        break;
      }
    }
  });

  return {
    session,
    history: () => session.messages.flatMap((message) => [normalise(message)].flat()).filter(Boolean),
    /**
     * Say something to turri: a slash command runs at once; while it is answering, it hears it after its turn. /login
     * and /logout are pi's terminal's alone - typed here they would go to the model as words - so they open the
     * window's sign-in sheet instead, on the provider named if one is.
     */
    send: (text) => {
      const signIn = /^\/(?:login|logout)(?:\s+(\S+))?\s*$/.exec(text.trim());
      if (signIn !== null) return emit("auth:open", { provider: signIn[1] ?? null });
      const run = session.isStreaming ? session.followUp(text) : session.prompt(text);
      Promise.resolve(run).catch((error) => emit("chat:notify", { level: "error", text: error instanceof Error ? error.message : String(error) }));
    },
    /**
     * The commands typing / offers, as pi has them: the extension's - /turri-config, /regenerate, /stack - its prompt
     * templates, and its skills as /skill:<name>. /halt is left out: halting a pulse is turri's alone, not the window's.
     */
    commands: () =>
      [
        ...session.extensionRunner.getRegisteredCommands().map((command) => ({ name: command.invocationName, description: command.description })),
        ...session.promptTemplates.map((template) => ({ name: template.name, description: template.description })),
        ...session.resourceLoader.getSkills().skills.map((skill) => ({ name: `skill:${skill.name}`, description: skill.description })),
      ]
        .filter((command) => command.name !== "halt")
        .map((command) => ({ name: `/${command.name}`, description: command.description ?? "" }))
        .concat({ name: "/login", description: "sign in to a model provider - with an API key, or a subscription in the browser" }),
    abort: () => session.abort(),
    onHarnessModel,
    model: () => (session.model ? `${session.model.provider}/${session.model.id}` : null),
    stats,
    dispose: () => session.dispose(),
  };
}

/** An entry turri's extension writes into the chat, as the window shows it - its terminal renderers' counterparts. */
function entryItem(entry) {
  if (entry?.type === "custom_message") return entry.display === false ? null : { role: "note", customType: entry.customType, text: textOf(entry.content) };
  if (entry?.type !== "custom") return null;
  const data = entry.data ?? {};
  switch (entry.customType) {
    case "turri_command_outcome":
      // The command as typed, then what it showed - the two in one entry when it was not echoed first.
      if (data.text === undefined) return { role: "command", text: data.command };
      return { role: "note", customType: entry.customType, level: data.level, text: data.echoed ? data.text : `${data.command}\n\n${data.text}` };
    case "turri_job":
      return { role: "job", id: data.id, summary: data.summary, status: data.incomplete ? "incomplete" : data.status, duration: data.duration, spent: data.spent, text: data.text };
    case "turri_history":
      return { role: "note", customType: entry.customType, text: `History of ${data.module}\n\n\`\`\`\n${data.text}\n\`\`\`` };
    case "turri_btw":
      return { role: "note", customType: entry.customType, text: `**By the way:** ${data.question}\n\n${data.answer}` };
    case "turri_exchange":
      return { role: "note", customType: entry.customType, text: `**${data.question}**\n\n${data.answer}` };
    default:
      return null;
  }
}

function splitLevel(spec) {
  const match = /^(.*):(off|minimal|low|medium|high|xhigh|max)$/.exec(spec);
  return match ? [match[1], match[2]] : [spec, undefined];
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/** A message as the window shows it - or several, or nothing for what the person never sees. */
function normalise(message) {
  if (message === undefined || message === null || retriedWithoutImages(message)) return null;
  switch (message.role) {
    case "user":
      return { role: "user", text: textOf(message.content) };
    case "assistant": {
      const parts = Array.isArray(message.content) ? message.content : [];
      return {
        role: "assistant",
        text: parts.filter((part) => part.type === "text").map((part) => part.text).join(""),
        thinking: parts.filter((part) => part.type === "thinking").map((part) => part.thinking).join(""),
        tools: parts.filter((part) => part.type === "toolCall").map((part) => ({ id: part.id, name: part.name, args: part.arguments })),
        error: message.stopReason === "error" ? (message.errorMessage ?? "The model returned an error.") : undefined,
      };
    }
    case "toolResult": {
      // What turri saw, when it was an image - the preview, as browser_screenshot took it.
      const image = Array.isArray(message.content) ? message.content.find((part) => part.type === "image") : undefined;
      return {
        role: "toolResult",
        id: message.toolCallId,
        name: message.toolName,
        text: textOf(message.content).slice(0, 4000),
        isError: message.isError === true,
        ...(image !== undefined ? { image: `data:${image.mimeType};base64,${image.data}` } : {}),
      };
    }
    case "custom":
      return message.display === false ? null : { role: "note", customType: message.customType, text: textOf(message.content) };
    default:
      return null;
  }
}

/** What turri's extension asks of the UI, answered by the window - and what only a terminal could do, let pass. */
function uiContext({ emit, ask }) {
  /** The components the extension has drawn, by their widget's key: each stopped when it is replaced or cleared. */
  const widgets = new Map();
  const theme = new Proxy(
    {},
    { get: (_target, key) => (key === "fg" || key === "bg" ? (_colour, text) => text : (text) => text) },
  );
  const known = {
    theme,
    select: (title, options) => ask({ kind: "select", title, options }),
    confirm: async (title, message) => (await ask({ kind: "confirm", title, message })) === true,
    input: (title, placeholder) => ask({ kind: "input", title, placeholder }),
    editor: (title, prefill) => ask({ kind: "editor", title, prefill }),
    notify: (message, type = "info") => emit("chat:notify", { level: type, text: message }),
    setStatus: (key, text) => emit("chat:status", { key, text: text ?? null }),
    setWorkingMessage: (message) => emit("chat:working", { text: message ?? null }),
    setWidget: (key, content) => {
      widgets.get(key)?.();
      widgets.delete(key);
      if (key === SKILL_WIDGET) {
        if (typeof content === "function") widgets.set(key, skillProgress(content, theme, emit));
        else emit("chat:progress", null);
        return;
      }
      if (content === undefined || Array.isArray(content)) emit("chat:widget", { key, lines: content ?? null });
    },
    setTitle: () => {},
    getToolsExpanded: () => false,
    getEditorText: () => "",
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false }),
    onTerminalInput: () => () => {},
    /**
     * A component of the extension's own, drawn in the terminal - a panel, a picker. ask_user's questions come through
     * the host's dialogs instead (engine.mjs); the rest have no window form yet, and are closed at once.
     */
    custom: () => Promise.resolve(undefined),
  };
  return new Proxy(known, { get: (target, key) => (key in target ? target[key] : () => undefined) });
}

/** The widget turri's extension draws above the input while a skill runs: its phases, and where it is in them. */
const SKILL_WIDGET = "turri-skill";
/** Wide enough that the line has every phase, not the compact form a narrow terminal gets. */
const WIDE = 1000;

/**
 * A skill's progress, as the window draws it: the extension draws it as a terminal component - one line of its phases,
 * done, current and to come, and one of what the phase it is in does - so the component is drawn here, plain, and its
 * lines read back. It is drawn again whenever it asks to be (its spinner, once a second), and the window told when
 * what it says changes: the skill, its phases and their state, where it is, and what that phase does.
 */
function skillProgress(factory, theme, emit) {
  let said;
  let component;
  const draw = () => {
    let lines;
    try {
      lines = component.render(WIDE);
    } catch {
      return;
    }
    const progress = readProgress(lines);
    const text = JSON.stringify(progress);
    if (text === said) return;
    said = text;
    emit("chat:progress", progress);
  };
  component = factory({ requestRender: draw }, theme);
  draw();
  return () => {
    component.dispose?.();
    emit("chat:progress", null);
  };
}

/**
 * The progress line read back: `brood   ✓ intent ━━━━ ⠋ stack ──── ○ testing ──── ○ product   phase 2 of 4`, and
 * under it `stack - the language, frameworks, storage and architecture`. A skill of one phase is its spinner and name.
 */
function readProgress([line = "", under = ""]) {
  const [head = "", bar, where] = line.trim().split(/\s{3,}/);
  if (where === undefined) return { skill: head.replace(/^\S+\s+/, ""), phases: [], where: bar ?? null, about: null };
  const phases = bar.split(/ [━─]+ /).map((step) => ({
    name: step.slice(2),
    state: step.startsWith("✓") ? "done" : step.startsWith("○") ? "todo" : "now",
  }));
  return { skill: head, phases, where: where ?? null, about: under.trim() || null };
}
