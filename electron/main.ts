import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, shell, type MenuItemConstructorOptions, type Rectangle } from "electron";
import { fork, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createPreview } from "./preview.ts";
import { loadShellEnvironment } from "./shell-env.ts";
import { createTerminal } from "./terminal.ts";
import { turriVersion } from "./turri-version.ts";

/**
 * The main process: a window for each open project, and behind each its own turri engine - a Node process that hosts
 * turri's work loop (engine/engine.mjs) - and its own preview. A window never shows turri in a terminal: it asks its
 * engine for data and is sent what the jobs do as they do it. The one terminal there is, the preview's, is for the app
 * turri builds.
 */

const ROOT = join(__dirname, "..");
/** macOS, or Linux: the window's chrome, the menu, the Dock and the file manager differ between them. */
const MAC = process.platform === "darwin";

// Opened from Finder, the Dock or a desktop launcher, the app has none of the person's shell: its PATH and keys are read
// from their login shell as it starts, and every engine waits for them.
const shellReady = loadShellEnvironment();
const RECENTS_FILE = join(app.getPath("userData"), "recent-projects.json");
const APPEARANCE_FILE = join(app.getPath("userData"), "appearance.json");

/** Dark - turri's own - unless the person chose light or to follow the system. */
type Theme = "dark" | "light" | "system";
let theme: Theme = readTheme();
/** How far the window is zoomed: 0 is actual size, each step about 20% bigger or smaller (Electron's zoom levels). */
let zoom = readAppearance().zoom ?? 0;
const ZOOM_MIN = -3;
const ZOOM_MAX = 5;

function readAppearance(): { theme?: Theme; zoom?: number } {
  try {
    return JSON.parse(readFileSync(APPEARANCE_FILE, "utf8")) as { theme?: Theme; zoom?: number };
  } catch {
    return {};
  }
}

function writeAppearance() {
  writeFileSync(APPEARANCE_FILE, JSON.stringify({ theme, zoom }));
}

function readTheme(): Theme {
  const chosen = readAppearance().theme;
  return chosen === "light" || chosen === "system" ? chosen : "dark";
}

/** Zoom in, out or back to actual size - the text and everything with it - and remember it. */
function setZoom(next: number) {
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  for (const { window } of workspaces.values()) window.webContents.setZoomLevel(zoom);
  writeAppearance();
}

/** The window's own colour behind the page, as the theme has it - what shows while it loads or resizes. */
function backgroundFor(): string {
  return (theme === "system" ? nativeTheme.shouldUseDarkColors : theme === "dark") ? "#0a0f1a" : "#f4f7f9";
}

function setTheme(next: Theme) {
  theme = next;
  writeAppearance();
  // Menus, dialogs and the title bar follow it too.
  nativeTheme.themeSource = theme;
  for (const workspace of workspaces.values()) {
    workspace.window.setBackgroundColor(backgroundFor());
    workspace.send("theme", theme);
  }
  buildMenu();
}

// ---------- a window and what is behind it ----------

/** A window and what is behind it: the project open in it, its engine, its preview and the preview's terminal. */
interface Workspace {
  window: BrowserWindow;
  preview: ReturnType<typeof createPreview>;
  terminal: ReturnType<typeof createTerminal>;
  send(channel: string, data: unknown): void;
  /** Its pulses running now. */
  running: number;
  /** The project open in it, once one is. */
  readonly dir: string | undefined;
  /** The project being opened in it, while it is. */
  readonly opening: string | undefined;
  /** Whether a project is open in it and answering - not one whose engine has stopped. */
  readonly open: boolean;
  /** Its project's name, once one is open. */
  readonly name: string | undefined;
  call(method: string, params?: unknown): Promise<unknown>;
  openProject(dir: string): Promise<unknown>;
  startProject(dir: string, vendor: string, bedrock?: { maker: string; region: string }, models?: { harness: string; coding: string }): Promise<unknown>;
  /** Its engine, started if no project has started it yet: for what it is asked before a project opens. */
  anEngine(): Promise<void>;
}

/** Every window, by its id: each with the project open in it, or none yet - the welcome screen. */
const workspaces = new Map<number, Workspace>();
/** The window the person was in last: the menu's and the Dock's, even while the app itself is not in front. */
let lastFocused: Workspace | undefined;
/** Windows by when they were last in front, the latest first: the project switcher lists them so. */
let byRecency: Workspace[] = [];

function workspaceOf(sender: Electron.WebContents): Workspace {
  const workspace = workspaces.get(BrowserWindow.fromWebContents(sender)?.id ?? -1);
  if (workspace === undefined) throw new Error("This window is closing.");
  return workspace;
}

function focused(): Workspace | undefined {
  const window = BrowserWindow.getFocusedWindow();
  return (window && workspaces.get(window.id)) ?? lastFocused;
}

/** Pulses running in every window: the Dock's badge counts them all. */
function showRunning() {
  const running = [...workspaces.values()].reduce((sum, workspace) => sum + workspace.running, 0);
  app.dock?.setBadge(running > 0 ? String(running) : "");
}

/**
 * One window - the welcome screen until a project opens in it - with the project's engine, its preview and the
 * preview's terminal. Closing the window stops them all.
 */
function createWorkspace(): Workspace {
  // A new window a step down and right of the one in front, so both are seen.
  const [x, y] = focused()?.window.getPosition() ?? [];
  const window = new BrowserWindow({
    width: 1560,
    height: 860,
    ...(x !== undefined && y !== undefined ? { x: x + 28, y: y + 28 } : {}),
    minWidth: 1100,
    minHeight: 620,
    title: "turri",
    icon: join(ROOT, "build", "icon.png"),
    // On macOS the window draws to its top edge, under the traffic lights; Linux keeps its window manager's title bar.
    ...(MAC ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 18 } } : {}),
    backgroundColor: backgroundFor(),
    show: false,
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: false },
  });

  const send = (channel: string, data: unknown) => {
    if (!window.isDestroyed()) window.webContents.send(channel, data);
  };
  const preview = createPreview({ windowOf: () => (window.isDestroyed() ? undefined : window), send });
  const terminal = createTerminal({ send });
  let engine: ChildProcess | undefined;
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  /** Whether the engine has a project open: one that has not - started for a new project's config - opens one as it is. */
  let engineHasProject = false;
  /** The project open in this window, and its name, once it is. */
  let dir: string | undefined;
  let name: string | undefined;
  /** The project being opened, while it is: the window waits under a spinner, and the menu's project items wait too. */
  let opening: string | undefined;
  let closed = false;
  /** Settled once the page has loaded: a project opened in a new window waits for it. */
  const loaded = new Promise<void>((resolve) => window.webContents.once("did-finish-load", () => resolve()));

  const workspace: Workspace = {
    window,
    preview,
    terminal,
    send,
    running: 0,
    get dir() {
      return dir;
    },
    get opening() {
      return opening;
    },
    get name() {
      return name;
    },
    get open() {
      return engine !== undefined && engineHasProject && opening === undefined;
    },
    call,
    openProject,
    startProject,
    anEngine,
  };

  async function startEngine(): Promise<void> {
    await shellReady;
    engine?.kill();
    for (const { reject } of pending.values()) reject(new Error("The engine restarted."));
    pending.clear();
    // Electron's own Node runs it: turri comes compiled, from the @turri-dev/cli package, so no other Node is needed.
    const child = fork(join(ROOT, "engine", "engine.mjs"), [], {
      execPath: process.execPath,
      execArgv: [],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    engine = child;
    child.stdout?.on("data", (chunk) => send("engine:log", { level: "stdout", text: String(chunk) }));
    child.stderr?.on("data", (chunk) => send("engine:log", { level: "stderr", text: String(chunk) }));
    return new Promise((resolve, reject) => {
      child.on("message", (message: { id?: number; result?: unknown; error?: string; event?: string; data?: unknown; browser?: string; terminal?: string; params?: unknown }) => {
        if (message.event === "ready") {
          // Which turri the engine runs - the package, or a clone's sources (TURRI_DEV) - said where the app was started.
          console.log(`turri engine: Node ${(message.data as { node: string }).node}, turri from ${(message.data as { turri: string }).turri}`);
          return resolve();
        }
        // One of turri's browser or terminal tools, asked of the preview: done there, and answered.
        if (message.browser !== undefined || message.terminal !== undefined) {
          const done = message.browser !== undefined ? preview.request(message.browser, message.params) : terminal.request(message.terminal!, message.params);
          done.then(
            (result) => child.connected && child.send({ reply: message.id, result }),
            (error) => child.connected && child.send({ reply: message.id, error: error instanceof Error ? error.message : String(error) }),
          );
          return;
        }
        if (message.event !== undefined) return onEngineEvent(message.event, message.data);
        const call = pending.get(message.id!);
        if (call === undefined) return;
        pending.delete(message.id!);
        if (message.error !== undefined) call.reject(new Error(message.error));
        else call.resolve(message.result);
      });
      child.on("exit", (code) => {
        reject(new Error(`The turri engine exited (${code}). ${process.env.TURRI_DEV ? `Is TURRI_DEV=${process.env.TURRI_DEV} a turri clone, with its packages installed (npm install there)?` : "Is @turri-dev/cli installed (npm install)?"}`));
        // One replaced by another, or stopped with its window, was stopped on purpose: only the current one's end is news.
        if (engine !== child || closed) return;
        engine = undefined;
        engineHasProject = false;
        workspace.running = 0;
        showRunning();
        send("engine:exit", { code });
        buildMenu();
      });
    });
  }

  function call(method: string, params?: unknown): Promise<unknown> {
    if (engine === undefined) return Promise.reject(new Error("No project is open."));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      engine!.send({ id, method, params });
    });
  }

  function onEngineEvent(event: string, data: any) {
    send(`engine:${event}`, data);
    // A sign-in's page, opened in the person's browser - the window shows the address too, for when it does not open.
    if (event === "auth:event" && data.event.type === "auth_url" && /^https?:\/\//.test(data.event.url)) void shell.openExternal(data.event.url);
    // New code under the preview: it is loaded again.
    if (event === "finished" && data.status === "succeeded") preview.reloadSoon();
    if (event === "status") {
      workspace.running = (data.jobs as Array<{ status: string }>).filter((job) => job.status === "running").length;
      showRunning();
      if (!window.isDestroyed()) window.setProgressBar(workspace.running > 0 ? 2 : -1); // 2: indeterminate on macOS
    }
    if (event === "finished" && !window.isDestroyed() && !window.isFocused()) {
      const done = data.status === "succeeded";
      // Which project's, with several open.
      const subtitle = dir === undefined ? undefined : basename(dir);
      const title = done ? `${data.module ?? "turri"}: regenerated` : `${data.module ?? "turri"}: ${data.status}`;
      // A subtitle is macOS's alone: elsewhere the project is said in the title.
      const notice = new Notification({ title: MAC || subtitle === undefined ? title : `${subtitle} - ${title}`, subtitle, body: data.title ?? "", silent: done });
      // A click brings the window the pulse ran in forward.
      notice.on("click", () => !window.isDestroyed() && (window.show(), window.focus()));
      notice.show();
      if (!done) app.dock?.bounce("informational");
    }
  }

  async function openProject(named: string) {
    const next = canonical(named);
    await loaded;
    // The project open now stops answering as soon as its engine is stopped: the window says it is opening another.
    opening = next;
    send("project:opening", { dir: next, name: basename(next) });
    buildMenu();
    try {
      if (engine === undefined || engineHasProject) await startEngine();
      engineHasProject = true;
      // Another project's app is not this one's: the preview starts empty, and its terminal in this project's folder.
      preview.dispose();
      terminal.setDir(next);
      const summary = await call("open", { dir: next });
      dir = next;
      name = (summary as { name: string }).name;
      writeFileSync(RECENTS_FILE, JSON.stringify([next, ...recents().filter((other) => other !== next)].slice(0, RECENTS_KEPT)));
      app.addRecentDocument(next);
      if (!window.isDestroyed()) {
        if (MAC) window.setRepresentedFilename(next);
        // The Window menu, ⌘` and the Dock name each window by it.
        window.setTitle(name);
      }
      return summary;
    } catch (error) {
      // Not opened: the window stops waiting. Opened, it stops once it has the project - sooner, the last one shows again.
      send("project:opening", null);
      throw error;
    } finally {
      opening = undefined;
      buildMenu();
    }
  }

  /** The engine, started if no project has started it yet: for what it is asked before a project opens. */
  async function anEngine() {
    if (engine === undefined) await startEngine();
  }

  /** A new project's config.turri.yaml, written by turri with the models chosen - then the project, opened on them. */
  async function startProject(dir: string, vendor: string, bedrock?: { maker: string; region: string }, models?: { harness: string; coding: string }) {
    await anEngine();
    const { message } = (await call("initConfig", { dir, vendor, bedrock, models })) as { message: string };
    // Its config written, the project is made, whether it opens or not: one that does not - no credentials for the models
    // chosen, say - is said so, not thrown, for the window to say why and try again.
    try {
      return { ...((await openProject(dir)) as object), setup: message };
    } catch (error) {
      return { setup: message, failed: error instanceof Error ? error.message : String(error) };
    }
  }

  workspaces.set(window.id, workspace);
  window.once("ready-to-show", () => window.show());
  window.on("focus", () => {
    lastFocused = workspace;
    byRecency = [workspace, ...byRecency.filter((other) => other !== workspace)];
    buildMenu();
  });
  // The zoom chosen last time, kept across reloads and launches.
  window.webContents.on("did-finish-load", () => window.webContents.setZoomLevel(zoom));
  // Links leave the app for the browser; the window only ever shows the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void window.loadFile(join(ROOT, "dist", "index.html"));
  window.on("closed", () => {
    // Gone first: the preview's clean-up must not reach for a window already destroyed, nor send to it.
    closed = true;
    workspaces.delete(window.id);
    if (lastFocused === workspace) lastFocused = undefined;
    byRecency = byRecency.filter((other) => other !== workspace);
    engine?.kill();
    preview.dispose();
    terminal.dispose();
    showRunning();
    buildMenu();
  });
  return workspace;
}

/** Every window's engine and terminal stopped: the app is quitting. */
function closeAll() {
  for (const { window } of workspaces.values()) if (!window.isDestroyed()) window.destroy();
}

// ---------- projects ----------

/** How many recent projects are kept: the welcome screen searches them. */
const RECENTS_KEPT = 30;

/** A project's folder as one path - absolute, its links followed - however it was named: the same folder is one recent. */
function canonical(dir: string): string {
  const full = resolve(dir);
  try {
    return realpathSync(full);
  } catch {
    return full;
  }
}

function recents(): string[] {
  try {
    const dirs = (JSON.parse(readFileSync(RECENTS_FILE, "utf8")) as string[]).filter((dir) => existsSync(dir)).map(canonical);
    return [...new Set(dirs)];
  } catch {
    return [];
  }
}

/**
 * Where a project opens: the window it is open in already, brought forward - one engine to a project, never two
 * work loops on the same files - or else the window asking, if it has no project yet, or else a window of its own.
 * What is opened is the window's to show; nothing is when the project was open already.
 */
function openWhere(from: Workspace | undefined, named: string): { into: Workspace; opened: Promise<unknown> } {
  const dir = canonical(named);
  const there = [...workspaces.values()].find((workspace) => workspace.dir === dir || workspace.opening === dir);
  if (there !== undefined) {
    there.window.show();
    there.window.focus();
    // Its engine stopped: it is opened again there.
    if (there.open || there.opening !== undefined) return { into: there, opened: Promise.resolve(null) };
    return { into: there, opened: there.openProject(dir) };
  }
  const into = from !== undefined && from.dir === undefined && from.opening === undefined ? from : createWorkspace();
  return { into, opened: into.openProject(dir) };
}

/** A project opened from the menu, the Dock or a welcome screen into another window: that window is sent it, or why not. */
function deliver({ into, opened }: { into: Workspace; opened: Promise<unknown> }) {
  opened.then(
    (summary) => summary && into.send("project:opened", summary),
    (error) => {
      const text = error instanceof Error ? error.message : String(error);
      // A window made for it, still on its welcome screen, says it there; one with a project, in its notice.
      into.send("project:failed", { text });
      if (into.dir === undefined) void dialog.showMessageBox(into.window, { type: "warning", message: "The project did not open.", detail: text });
    },
  );
}

/** A project opened from a welcome screen: its summary when it opened there, null when it opened - or was open - in another window. */
async function openFrom(from: Workspace, named: string) {
  const where = openWhere(from, named);
  if (where.into === from) return where.opened;
  deliver(where);
  return null;
}

async function chooseProject(from: Workspace | undefined) {
  const options = { title: "Open a turri project", properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">, buttonLabel: "Open Project" };
  const result = from ? await dialog.showOpenDialog(from.window, options) : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0]!;
}

/**
 * A new project's folder: named and placed in the save sheet, and made. A folder of that name with anything in it
 * already is not taken over. Nothing is opened yet - the window asks which models it runs on first (startProject).
 */
async function newProjectFolder(from: Workspace) {
  const result = await dialog.showSaveDialog(from.window, {
    title: "Start a new turri project",
    buttonLabel: "Create",
    nameFieldLabel: "Project name:",
    defaultPath: join(app.getPath("documents"), "my-project"),
    properties: ["createDirectory"],
  });
  if (result.canceled || result.filePath === undefined) return null;
  const dir = result.filePath;
  if (existsSync(dir) && (!statSync(dir).isDirectory() || readdirSync(dir).some((name) => !name.startsWith(".")))) {
    throw new Error(`${basename(dir)} is there already, with files in it: choose another name, or open it as a project.`);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The projects open in every window, the one last in front first - each with its window's id, and whether it is the asking one. */
function openProjects(from: Workspace) {
  const all = [...byRecency, ...[...workspaces.values()].filter((workspace) => !byRecency.includes(workspace))];
  return all
    .filter((workspace) => workspace.dir !== undefined)
    .map((workspace) => ({ id: workspace.window.id, name: workspace.name ?? basename(workspace.dir!), dir: workspace.dir!, running: workspace.running, here: workspace === from }));
}

/** A new project is started in a window with none yet: the one in front if it has none, a new one otherwise. */
async function newProject() {
  const front = focused();
  const into = front !== undefined && front.dir === undefined && front.opening === undefined ? front : createWorkspace();
  await new Promise<void>((resolve) => (into.window.webContents.isLoading() ? into.window.webContents.once("did-finish-load", () => resolve()) : resolve()));
  into.send("menu", "new-project");
}

// ---------- the menu ----------

function buildMenu() {
  const front = focused();
  const menuAction = (action: string) => () => focused()?.send("menu", action);
  const ready = front?.open === true;
  const template: MenuItemConstructorOptions[] = [
    // macOS's app menu - About, Hide, Quit; elsewhere Quit is in File.
    ...(MAC ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { label: "New Project…", accelerator: "CmdOrCtrl+N", click: () => void newProject() },
        { label: "Open Project…", accelerator: "CmdOrCtrl+O", click: async () => {
          const from = focused();
          const dir = await chooseProject(from);
          if (dir !== null) deliver(openWhere(from, dir));
        } },
        ...(MAC ? [{ role: "recentDocuments", submenu: [{ role: "clearRecentDocuments" }] } as MenuItemConstructorOptions] : []),
        { label: "New Window", accelerator: "CmdOrCtrl+Shift+N", click: () => void createWorkspace() },
        { label: "Switch Project…", accelerator: "CmdOrCtrl+Shift+P", click: menuAction("switch-project") },
        { type: "separator" },
        { label: "Sign In to Model Providers…", click: menuAction("sign-in") },
        { type: "separator" },
        { label: "Save Spec", accelerator: "CmdOrCtrl+S", click: menuAction("save"), enabled: ready },
        { type: "separator" },
        { label: MAC ? "Reveal Project in Finder" : "Show Project in File Manager", click: menuAction("reveal"), enabled: ready },
        { type: "separator" },
        { role: "close" },
        ...(MAC ? [] : [{ role: "quit" as const }]),
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "intent", accelerator: "CmdOrCtrl+1", click: menuAction("view:spec") },
        { label: "work", accelerator: "CmdOrCtrl+2", click: menuAction("view:work") },
        { label: "preview", accelerator: "CmdOrCtrl+3", click: menuAction("view:preview") },
        { type: "separator" },
        { label: "Show or Hide the Chat", accelerator: "CmdOrCtrl+J", click: menuAction("chat") },
        {
          label: "Appearance",
          submenu: (["dark", "light", "system"] as Theme[]).map((name) => ({
            label: name === "system" ? "Same as the System" : name === "dark" ? "Dark" : "Light",
            type: "radio" as const,
            checked: theme === name,
            click: () => setTheme(name),
          })),
        },
        { type: "separator" },
        { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: () => setZoom(0) },
        { label: "Zoom In", accelerator: "CmdOrCtrl+Plus", click: () => setZoom(zoom + 0.5) },
        // ⌘= as well: on most keyboards + is shift+=, and ⌘+ is pressed without the shift.
        { label: "Zoom In", accelerator: "CmdOrCtrl+=", click: () => setZoom(zoom + 0.5), visible: false, acceleratorWorksWhenHidden: true },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: () => setZoom(zoom - 0.5) },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    // macOS lists the open windows here, each by its project's name, and ⌘` goes from one to the next; Linux has
    // Minimize and Close.
    { role: "windowMenu" },
    // At the right, before Help: what turri does with the spec in front.
    {
      label: "Spec",
      submenu: [
        { label: "Regenerate…", accelerator: "CmdOrCtrl+R", click: menuAction("regenerate-how"), enabled: ready },
        { label: "Regenerate What Changed", accelerator: "CmdOrCtrl+Shift+R", click: menuAction("regenerate"), enabled: ready },
        { label: "Preview the Plan", click: menuAction("glimpse"), enabled: ready },
        { label: "Write Conformance Tests", click: menuAction("conform"), enabled: ready },
        { label: "Release to Try", click: menuAction("release"), enabled: ready },
      ],
    },
    { role: "help", submenu: [{ label: "Check This Machine…", click: menuAction("doctor") }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- the bridge ----------

// Each window asks of its own workspace: its engine, its preview, its terminal.
ipcMain.handle("engine:call", (event, method: string, params: unknown) => workspaceOf(event.sender).call(method, params));
ipcMain.handle("project:choose", async (event) => {
  const from = workspaceOf(event.sender);
  const dir = await chooseProject(from);
  return dir === null ? null : openFrom(from, dir);
});
ipcMain.handle("project:new", (event) => newProjectFolder(workspaceOf(event.sender)));
ipcMain.handle("project:vendors", async (event) => {
  const workspace = workspaceOf(event.sender);
  await workspace.anEngine();
  return workspace.call("vendors");
});
// Whether this machine - and the window's project, once one is open - is ready for turri: asked of its engine, started for it if
// need be, so the checks look on the PATH turri runs with.
ipcMain.handle("doctor:run", async (event, models: boolean, dir?: string) => {
  const workspace = workspaceOf(event.sender);
  await workspace.anEngine();
  return workspace.call("doctor", { models, ...(dir !== undefined ? { dir } : {}) });
});
// Signing in to the model providers, asked of the window's engine - started for it if need be, as on the welcome screen.
const AUTH_METHODS = new Set(["authProviders", "authLogin", "authAnswer", "authCancel", "authLogout"]);
ipcMain.handle("auth:call", async (event, method: string, params: unknown) => {
  if (!AUTH_METHODS.has(method)) throw new Error(`Not a sign-in method: ${method}`);
  const workspace = workspaceOf(event.sender);
  await workspace.anEngine();
  return workspace.call(method, params);
});
ipcMain.handle("project:start", (event, dir: string, vendor: string, bedrock?: { maker: string; region: string }, models?: { harness: string; coding: string }) =>
  workspaceOf(event.sender).startProject(dir, vendor, bedrock, models),
);
// A new project given up before it started: its folder, made for it and still empty, taken away again.
ipcMain.handle("project:abandon", (_event, dir: string) => {
  try {
    rmdirSync(dir);
  } catch {
    /* something is in it now: it stays */
  }
});
ipcMain.handle("project:open", (event, dir: string) => openFrom(workspaceOf(event.sender), dir));
ipcMain.handle("project:recents", () => recents());
ipcMain.handle("projects:list", (event) => openProjects(workspaceOf(event.sender)));
// Another open project's window, brought forward.
ipcMain.handle("projects:switch", (_event, id: number) => {
  const workspace = workspaces.get(id);
  if (workspace === undefined) return;
  workspace.window.show();
  workspace.window.focus();
});
ipcMain.handle("shell:reveal", (_event, path: string) => shell.showItemInFolder(path));
ipcMain.handle("shell:open", (_event, path: string) => shell.openPath(path));
ipcMain.handle("preview:place", (event, rect: Rectangle | null) => workspaceOf(event.sender).preview.place(rect));
ipcMain.handle("preview:open", (event, url: string) => workspaceOf(event.sender).preview.open(url));
ipcMain.handle("preview:go", (event, action: "back" | "forward" | "reload" | "stop" | "devtools") => workspaceOf(event.sender).preview.go(action));
ipcMain.handle("preview:state", (event) => workspaceOf(event.sender).preview.state());
ipcMain.handle("terminal:open", (event) => workspaceOf(event.sender).terminal.open());
ipcMain.handle("terminal:write", (event, data: string) => workspaceOf(event.sender).terminal.write(data));
ipcMain.handle("terminal:resize", (event, cols: number, rows: number) => workspaceOf(event.sender).terminal.resize(cols, rows));
ipcMain.handle("terminal:restart", (event) => workspaceOf(event.sender).terminal.restart());
// Which turri the app runs - worked out once: it does not change while the app runs.
const turri = turriVersion(ROOT);
ipcMain.handle("turri:version", () => turri);
ipcMain.handle("theme:get", () => theme);
nativeTheme.on("updated", () => {
  for (const { window } of workspaces.values()) window.setBackgroundColor(backgroundFor());
});
// A native context menu: the window lists what it offers, and is told which was chosen.
ipcMain.handle("menu:popup", (event, items: Array<{ id: string; label: string; enabled?: boolean } | { type: "separator" }>) => {
  return new Promise<string | null>((resolve) => {
    let chosen: string | null = null;
    const menu = Menu.buildFromTemplate(
      items.map((item) => ("type" in item ? { type: "separator" as const } : { label: item.label, enabled: item.enabled !== false, click: () => (chosen = item.id) })),
    );
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender)!, callback: () => resolve(chosen) });
  });
});

// A project from the Dock, Finder or the recent documents: in the window in front if it has none, a new one otherwise.
app.on("open-file", (event, path) => {
  event.preventDefault();
  void app.whenReady().then(() => deliver(openWhere(focused(), path)));
});

app.whenReady().then(() => {
  console.log(`turri ${turri.from === "npm" ? "from npm" : "from a clone"}: ${turri.label}${turri.warning ? ` - ${turri.warning}` : ""}`);
  app.setName("turri");
  // The bundle carries the icon once scripts/brand.mjs has run; the Dock is given it as well, for when it has not.
  app.dock?.setIcon(join(ROOT, "build", "icon.png"));
  // The Dock's menu lists the windows on its own; a new one is opened from it too.
  app.dock?.setMenu(Menu.buildFromTemplate([{ label: "New Window", click: () => void createWorkspace() }]));
  nativeTheme.themeSource = theme;
  buildMenu();
  const first = createWorkspace();
  // For development: TURRI_APP_OPEN opens a project at start, TURRI_APP_SCREENSHOT=<file.png> captures the window and quits.
  first.window.webContents.once("did-finish-load", async () => {
    if (process.env.TURRI_APP_OPEN) first.send("project:opened", await first.openProject(process.env.TURRI_APP_OPEN));
    if (process.env.TURRI_APP_SCREENSHOT) {
      if (process.env.TURRI_APP_VIEW) setTimeout(() => first.send("menu", `view:${process.env.TURRI_APP_VIEW}`), 300);
      setTimeout(async () => {
        writeFileSync(process.env.TURRI_APP_SCREENSHOT!, (await first.window.webContents.capturePage()).toPNG());
        app.quit();
      }, 2500);
    }
  });
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWorkspace());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Quitting - ⌘Q, the menu, app.quit() - closes no window first, so each window's engine and terminal are stopped here.
app.on("will-quit", closeAll);
