// turri's hands on a CLI it builds: terminal tools for the chat's agent, on the preview's terminal - a shell in the
// project's folder the person is looking at. A pi extension of the app's own, loaded beside turri's and the browser
// tools: each tool is a request to the main process, which runs the shell (electron/terminal.ts). They exist only in the
// app. turri's own bash tool is for its work; these are for trying what it built where the person watches.

/** Tools on the preview's terminal, each sent as `request(action, params)` and answered with what came of it. */
export function terminalExtension(request) {
  return (pi) => {
    for (const tool of tools(request)) pi.registerTool(tool);
  };
}

/** The keys terminal_type presses: electron/terminal.ts has the bytes for each. */
const KEYS = ["enter", "tab", "escape", "backspace", "up", "down", "left", "right", "ctrl-c", "ctrl-d", "ctrl-z"];

const GUIDELINES = [
  "The terminal_* tools drive the terminal in the person's preview view - a shell in the project's folder - and the person watches what you do there.",
  "Use them to try what you built as the person would: run a CLI with the arguments the spec gives it, answer its prompts, read what it prints. For your own work - building, installing, tests - use bash as usual.",
  "terminal_run returns once the command is back at the prompt, or once it has gone quiet while still running - waiting for input, or serving: say so, and answer it with terminal_type, or stop it with the key ctrl-c.",
  "A server started there runs on in the person's terminal: to try it in the browser too, run it with terminal_run, then open it with browser_navigate.",
];

function tools(request) {
  const text = (value) => ({ type: "text", text: value });
  /** What the terminal shows since the command, and whether something still runs in it. */
  const said = (result) => {
    const now = !result.running ? "The shell has ended: the next command starts a new one." : result.atPrompt ? "Back at the prompt." : `Still running: ${result.program} - waiting for input, or serving. Answer it with terminal_type, or stop it with the key ctrl-c.`;
    return `${result.text || "(nothing printed)"}\n\n[${now}]`;
  };
  const WAIT = { type: "integer", description: "The most seconds to wait for it to finish or go quiet." };
  return [
    {
      name: "terminal_run",
      label: "Run in the terminal",
      description: "Run a command in the preview's terminal, where the person watches - a shell in the project's folder, such as ./dist/cli/todo add \"milk\". Returns what it printed, and whether it is back at the prompt or still running.",
      promptSnippet: "Run a command in the person's preview terminal, to try a CLI",
      promptGuidelines: GUIDELINES,
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "The command line, as typed at the prompt." }, wait: { ...WAIT, description: `${WAIT.description} 15 unless said.` } },
        required: ["command"],
        additionalProperties: false,
      },
      execute: async (_id, { command, wait }) => ({ content: [text(said(await request("run", { command, wait })))], details: undefined }),
    },
    {
      name: "terminal_type",
      label: "Type in the terminal",
      description: "Type into what runs in the preview's terminal - answer a prompt, use an interactive program - and press a key after it, or a key alone: enter, ctrl-c to stop it. Returns what it printed since.",
      promptSnippet: "Type text or press a key in the preview terminal",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "What to type." },
          key: { type: "string", enum: KEYS, description: "A key to press after the text, or alone." },
          wait: { ...WAIT, description: `${WAIT.description} 5 unless said.` },
        },
        additionalProperties: false,
      },
      execute: async (_id, { text: typed, key, wait }) => ({ content: [text(said(await request("type", { text: typed, key, wait })))], details: undefined }),
    },
    {
      name: "terminal_read",
      label: "Read the terminal",
      description: "Read the preview's terminal as it is now - the screen and what scrolled above it - and whether something still runs in it: a server's log, a program's output since.",
      promptSnippet: "Read the preview terminal's screen and scrollback",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => ({ content: [text(said(await request("read", {})))], details: undefined }),
    },
  ];
}
