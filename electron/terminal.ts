import { Terminal as Screen } from "@xterm/headless";
import { spawn, type IPty } from "node-pty";
import { basename } from "node:path";

/**
 * The preview's terminal: a shell in the project's folder, on a pty of its own, for a CLI turri builds - run, typed
 * into and read as a person would. The window draws it (src/Terminal.tsx, xterm.js) from what it is sent; a headless
 * xterm here keeps the same screen, so what turri reads is what the person sees, cursor moves and all. turri's terminal
 * tools (engine/terminal.mjs) are requests the engine sends here, done in the shell the person is looking at.
 */

export interface TerminalState {
  /** Whether a shell runs - it ended when the person typed exit, say. */
  running: boolean;
  /** What runs in it now: the shell itself at its prompt, or the program in the foreground. */
  program: string;
}

/** What the window replays when it draws the terminal again - another view and back: the newest output, raw. */
const REPLAY_KEPT = 512 * 1024;
/** The lines the headless screen keeps above what shows: what turri can read back of a long output. */
const SCROLLBACK = 5000;
/** The most of a terminal's text a tool gives: the end of it, a long output cut at its start. */
const TEXT_KEPT = 20000;
/** Output quiet for this long, with the shell back at its prompt: the command is done. */
const SETTLED_MS = 300;
/** Output quiet for this long, with a program still running: it waits - for input, or as a server does. */
const WAITING_MS = 1500;

/** Keys turri may press, as the bytes a terminal sends for them. */
const KEYS: Record<string, string> = {
  enter: "\r",
  tab: "\t",
  escape: "\x1b",
  backspace: "\x7f",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  "ctrl-c": "\x03",
  "ctrl-d": "\x04",
  "ctrl-z": "\x1a",
};
export const TERMINAL_KEYS = Object.keys(KEYS);

export function createTerminal({ send }: { send: (channel: string, data: unknown) => void }) {
  let dir: string | undefined;
  let pty: IPty | undefined;
  let screen: Screen | undefined;
  let replay = "";
  let lastOutput = 0;
  let size = { cols: 100, rows: 30 };
  const shell = process.env.SHELL || "/bin/zsh";

  const state = (): TerminalState => ({ running: pty !== undefined, program: pty === undefined ? "" : foreground() });
  const tell = () => send("terminal:state", state());
  /** The program in the foreground - the shell's own name while it waits at its prompt. */
  const foreground = () => {
    try {
      return pty?.process ?? "";
    } catch {
      return "";
    }
  };
  const atPrompt = () => foreground() === basename(shell);

  /** The shell, started in the project's folder: a login shell, so a packaged app has the person's PATH too. */
  function start(): IPty {
    if (pty !== undefined) return pty;
    if (dir === undefined) throw new Error("No project is open.");
    const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "turri" } as Record<string, string>;
    delete env.VITE_DEV_SERVER_URL;
    delete env.ELECTRON_RUN_AS_NODE;
    const started = spawn(shell, ["-l"], { name: "xterm-256color", cols: size.cols, rows: size.rows, cwd: dir, env });
    pty = started;
    screen = new Screen({ cols: size.cols, rows: size.rows, scrollback: SCROLLBACK, allowProposedApi: true });
    started.onData((data) => {
      if (pty !== started) return;
      lastOutput = Date.now();
      screen?.write(data);
      replay = (replay + data).slice(-REPLAY_KEPT);
      send("terminal:data", data);
    });
    // What runs in it, for the window's bar: a program started or ended says nothing of it, so it is looked at.
    let said = "";
    const watch = setInterval(() => {
      const now = foreground();
      if (now !== said) (said = now), tell();
    }, 1000);
    started.onExit(() => {
      clearInterval(watch);
      if (pty !== started) return;
      pty = undefined;
      const ended = "\r\n[the shell ended - type to start another]\r\n";
      replay += ended;
      send("terminal:data", ended);
      tell();
    });
    tell();
    return started;
  }

  /** A project opened: the shell of the last one is ended, and the next starts in this one's folder. */
  function setDir(next: string | undefined) {
    dispose();
    dir = next;
  }

  function dispose() {
    const ended = pty;
    pty = undefined;
    ended?.kill();
    screen?.dispose();
    screen = undefined;
    replay = "";
    send("terminal:reset", null);
    tell();
  }

  /** A new shell, the old one ended: what the window's restart does. */
  function restart() {
    dispose();
    start();
  }

  // ---------- what the window does with it ----------

  /** What the person types, as xterm.js sends it. */
  function write(data: string) {
    start().write(data);
  }

  function resize(cols: number, rows: number) {
    if (cols < 2 || rows < 2) return;
    size = { cols, rows };
    pty?.resize(cols, rows);
    screen?.resize(cols, rows);
  }

  /** What the window draws when it opens the terminal: the shell started, and what it has said so far. */
  function open() {
    start();
    return { replay, ...state() };
  }

  // ---------- what turri asks of it ----------

  /** The text of the screen and what scrolled above it, from a line on - all of it, by default - its end kept. */
  async function text(from = 0): Promise<string> {
    if (screen === undefined) return "";
    // What was written is parsed in its own time: until it has been, the screen is behind.
    await new Promise<void>((resolve) => screen!.write("", resolve));
    const buffer = screen.buffer.active;
    const lines: string[] = [];
    for (let row = Math.max(0, from); row < buffer.length; row++) {
      const line = buffer.getLine(row);
      if (line === undefined) continue;
      // A wrapped line goes on the one before it, as one.
      if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += line.translateToString(true);
      else lines.push(line.translateToString(true));
    }
    const said = lines.join("\n").replace(/\n+$/, "");
    return said.length > TEXT_KEPT ? `[... the start cut, ${said.length - TEXT_KEPT} characters]\n${said.slice(-TEXT_KEPT)}` : said;
  }

  /** Until what the shell was sent has had its answer: back at its prompt, or quiet while a program waits, or out of time. */
  async function settle(seconds: number) {
    const began = Date.now();
    const until = began + seconds * 1000;
    // A moment for the shell to start on it, and for a program to take the foreground.
    await new Promise((resolve) => setTimeout(resolve, 150));
    while (Date.now() < until && pty !== undefined) {
      const quiet = Date.now() - lastOutput;
      if (quiet >= SETTLED_MS && atPrompt()) break;
      if (quiet >= WAITING_MS && !atPrompt()) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** What came of it: the terminal's text since the line it began on, and what runs now. */
  async function outcome(marker: { line: number; isDisposed: boolean } | undefined) {
    const from = marker === undefined || marker.isDisposed ? 0 : marker.line;
    const program = pty === undefined ? "" : foreground();
    return { text: await text(from), running: pty !== undefined, program, atPrompt: pty !== undefined && atPrompt() };
  }

  /** The window shows the terminal - turri works in the one the person is looking at. */
  const reveal = () => send("terminal:reveal", null);

  const actions: Record<string, (params: any) => Promise<unknown>> = {
    run: async ({ command, wait }: { command: string; wait?: number }) => {
      const shellNow = start();
      reveal();
      if (!atPrompt()) throw new Error(`${foreground()} is running in the terminal: stop it first (terminal_type with the key ctrl-c), or answer it with terminal_type.`);
      const marker = screen?.registerMarker(0);
      shellNow.write(`${command}\r`);
      await settle(Math.min(Math.max(wait ?? 15, 1), 300));
      const result = await outcome(marker);
      marker?.dispose();
      return result;
    },
    type: async ({ text: typed, key, wait }: { text?: string; key?: string; wait?: number }) => {
      if (!typed && !key) throw new Error("Say what to type: text, a key, or both.");
      if (key !== undefined && KEYS[key] === undefined) throw new Error(`No such key: ${key}. The keys are ${TERMINAL_KEYS.join(", ")}.`);
      const shellNow = start();
      reveal();
      const marker = screen?.registerMarker(0);
      shellNow.write(`${typed ?? ""}${key !== undefined ? KEYS[key] : ""}`);
      await settle(Math.min(Math.max(wait ?? 5, 1), 300));
      const result = await outcome(marker);
      marker?.dispose();
      return result;
    },
    read: async () => {
      if (pty === undefined && replay === "") throw new Error("Nothing has run in the terminal yet: run something with terminal_run.");
      reveal();
      return outcome(undefined);
    },
  };

  function request(action: string, params: unknown): Promise<unknown> {
    const run = actions[action];
    if (run === undefined) return Promise.reject(new Error(`No such terminal action: ${action}`));
    return run(params ?? {});
  }

  return { setDir, dispose, restart, write, resize, open, state, request };
}
