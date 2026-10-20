import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, shell, type MenuItemConstructorOptions, type Rectangle } from "electron";
import { fork, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createPreview } from "./preview.ts";

/**
 * The main process: one window, and behind it one turri engine per open project - a Node process that hosts
 * turri's work loop (engine/engine.mjs). The window never sees a terminal: it asks the engine for data and is
 * sent what the jobs do as they do it.
 */

const ROOT = join(__dirname, "..");
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
  window?.webContents.setZoomLevel(zoom);
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
  window?.setBackgroundColor(backgroundFor());
  send("theme", theme);
  buildMenu();
}

let window: BrowserWindow | undefined;
const preview = createPreview({ windowOf: () => window, send });
let engine: ChildProcess | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let running = 0;
/** Whether the engine has a project open: one that has not - started for a new project's config - opens one as it is. */
let engineHasProject = false;

function startEngine(): Promise<void> {
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
    child.on("message", (message: { id?: number; result?: unknown; error?: string; event?: string; data?: unknown; browser?: string; params?: unknown }) => {
      if (message.event === "ready") return resolve();
      // One of turri's browser tools, asked of the preview: done there, and answered.
      if (message.browser !== undefined) {
        preview.request(message.browser, message.params).then(
          (result) => child.connected && child.send({ browserReply: message.id, result }),
          (error) => child.connected && child.send({ browserReply: message.id, error: error instanceof Error ? error.message : String(error) }),
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
      reject(new Error(`The turri engine exited (${code}). Is @turri-dev/cli installed (npm install)?`));
      // One replaced by another - a project opened after another - was stopped on purpose: only the current one's end is news.
      if (engine !== child) return;
      engine = undefined;
      engineHasProject = false;
      send("engine:exit", { code });
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

function send(channel: string, data: unknown) {
  window?.webContents.send(channel, data);
}

function onEngineEvent(event: string, data: any) {
  send(`engine:${event}`, data);
  // New code under the preview: it is loaded again.
  if (event === "finished" && data.status === "succeeded") preview.reloadSoon();
  if (event === "status") {
    running = (data.jobs as Array<{ status: string }>).filter((job) => job.status === "running").length;
    app.dock?.setBadge(running > 0 ? String(running) : "");
    window?.setProgressBar(running > 0 ? 2 : -1); // 2: indeterminate on macOS
  }
  if (event === "finished" && !window?.isFocused()) {
    const done = data.status === "succeeded";
    new Notification({ title: done ? `${data.module ?? "turri"}: regenerated` : `${data.module ?? "turri"}: ${data.status}`, body: data.title ?? "", silent: done }).show();
    if (!done) app.dock?.bounce("informational");
  }
}

// ---------- projects ----------

function recents(): string[] {
  try {
    return (JSON.parse(readFileSync(RECENTS_FILE, "utf8")) as string[]).filter((dir) => existsSync(dir));
  } catch {
    return [];
  }
}

async function openProject(dir: string) {
  if (engine === undefined || engineHasProject) await startEngine();
  engineHasProject = true;
  // Another project's app is not this one's: the preview starts empty.
  preview.dispose();
  const summary = await call("open", { dir });
  writeFileSync(RECENTS_FILE, JSON.stringify([dir, ...recents().filter((other) => other !== dir)].slice(0, 8)));
  app.addRecentDocument(dir);
  window?.setRepresentedFilename(dir);
  window?.setTitle((summary as { name: string }).name);
  buildMenu();
  return summary;
}

async function chooseProject() {
  const result = await dialog.showOpenDialog(window!, { title: "Open a turri project", properties: ["openDirectory", "createDirectory"], buttonLabel: "Open Project" });
  if (result.canceled || result.filePaths.length === 0) return null;
  return openProject(result.filePaths[0]!);
}

/**
 * A new project's folder: named and placed in the save sheet, and made. A folder of that name with anything in it
 * already is not taken over. Nothing is opened yet - the window asks which models it runs on first (startProject).
 */
async function newProjectFolder() {
  const result = await dialog.showSaveDialog(window!, {
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

/** The engine, started if no project has started it yet: for what it is asked before a project opens. */
async function anEngine() {
  if (engine === undefined) await startEngine();
}

/** A new project's config.turri.yaml, written by turri with the models chosen - then the project, opened on them. */
async function startProject(dir: string, vendor: string, bedrock?: { maker: string; region: string }) {
  await anEngine();
  const { message } = (await call("initConfig", { dir, vendor, bedrock })) as { message: string };
  return { ...((await openProject(dir)) as object), setup: message };
}

// ---------- the window ----------

function createWindow() {
  window = new BrowserWindow({
    width: 1560,
    height: 860,
    minWidth: 1100,
    minHeight: 620,
    title: "turri",
    icon: join(ROOT, "build", "icon.png"),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: backgroundFor(),
    show: false,
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: false },
  });
  window.once("ready-to-show", () => window?.show());
  // The zoom chosen last time, kept across reloads and launches.
  window.webContents.on("did-finish-load", () => window?.webContents.setZoomLevel(zoom));
  // For development: TURRI_APP_OPEN opens a project at start, TURRI_APP_SCREENSHOT=<file.png> captures the window and quits.
  window.webContents.once("did-finish-load", async () => {
    if (process.env.TURRI_APP_OPEN) send("project:opened", await openProject(process.env.TURRI_APP_OPEN));
    if (process.env.TURRI_APP_SCREENSHOT) {
      if (process.env.TURRI_APP_VIEW) setTimeout(() => send("menu", `view:${process.env.TURRI_APP_VIEW}`), 300);
      setTimeout(async () => {
        writeFileSync(process.env.TURRI_APP_SCREENSHOT!, (await window!.webContents.capturePage()).toPNG());
        app.quit();
      }, 2500);
    }
  });
  // Links leave the app for the browser; the window only ever shows the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void window.loadFile(join(ROOT, "dist", "index.html"));
  window.on("closed", () => {
    // Gone first: the preview's clean-up must not reach for a window already destroyed, nor send to it.
    window = undefined;
    preview.dispose();
  });
}

function buildMenu() {
  const menuAction = (action: string) => () => send("menu", action);
  const template: MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
        { label: "New Project…", accelerator: "CmdOrCtrl+N", click: menuAction("new-project") },
        { label: "Open Project…", accelerator: "CmdOrCtrl+O", click: () => void chooseProject().then((summary) => summary && send("project:opened", summary)) },
        { role: "recentDocuments", submenu: [{ role: "clearRecentDocuments" }] } as MenuItemConstructorOptions,
        { type: "separator" },
        { label: "Save Spec", accelerator: "CmdOrCtrl+S", click: menuAction("save"), enabled: engine !== undefined },
        { type: "separator" },
        { label: "Reveal Project in Finder", click: menuAction("reveal"), enabled: engine !== undefined },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    {
      label: "Spec",
      submenu: [
        { label: "Regenerate…", accelerator: "CmdOrCtrl+R", click: menuAction("regenerate-how"), enabled: engine !== undefined },
        { label: "Regenerate What Changed", accelerator: "CmdOrCtrl+Shift+R", click: menuAction("regenerate"), enabled: engine !== undefined },
        { label: "Preview the Plan", accelerator: "CmdOrCtrl+Shift+P", click: menuAction("glimpse"), enabled: engine !== undefined },
        { label: "Write Conformance Tests", click: menuAction("conform"), enabled: engine !== undefined },
        { label: "Release to Try", click: menuAction("release"), enabled: engine !== undefined },
      ],
    },
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
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- the bridge ----------

ipcMain.handle("engine:call", (_event, method: string, params: unknown) => call(method, params));
ipcMain.handle("project:choose", () => chooseProject());
ipcMain.handle("project:new", () => newProjectFolder());
ipcMain.handle("project:vendors", async () => (await anEngine(), call("vendors")));
ipcMain.handle("project:start", (_event, dir: string, vendor: string, bedrock?: { maker: string; region: string }) => startProject(dir, vendor, bedrock));
// A new project given up before it started: its folder, made for it and still empty, taken away again.
ipcMain.handle("project:abandon", (_event, dir: string) => {
  try {
    rmdirSync(dir);
  } catch {
    /* something is in it now: it stays */
  }
});
ipcMain.handle("project:open", (_event, dir: string) => openProject(dir));
ipcMain.handle("project:recents", () => recents());
ipcMain.handle("shell:reveal", (_event, path: string) => shell.showItemInFolder(path));
ipcMain.handle("shell:open", (_event, path: string) => shell.openPath(path));
ipcMain.handle("preview:place", (_event, rect: Rectangle | null) => preview.place(rect));
ipcMain.handle("preview:open", (_event, url: string) => preview.open(url));
ipcMain.handle("preview:go", (_event, action: "back" | "forward" | "reload" | "stop" | "devtools") => preview.go(action));
ipcMain.handle("preview:state", () => preview.state());
ipcMain.handle("theme:get", () => theme);
ipcMain.handle("theme:set", (_event, next: Theme) => setTheme(next));
nativeTheme.on("updated", () => window?.setBackgroundColor(backgroundFor()));
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

app.on("open-file", (event, path) => {
  event.preventDefault();
  if (window) void openProject(path).then((summary) => send("project:opened", summary));
});

app.whenReady().then(() => {
  app.setName("turri");
  // The bundle carries the icon once scripts/brand.mjs has run; the Dock is given it as well, for when it has not.
  app.dock?.setIcon(join(ROOT, "build", "icon.png"));
  nativeTheme.themeSource = theme;
  buildMenu();
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on("window-all-closed", () => {
  engine?.kill();
  if (process.platform !== "darwin") app.quit();
});

// Quitting - ⌘Q, the menu, app.quit() - closes no window first, so the engine is stopped here too.
app.on("will-quit", () => engine?.kill());

app.on("before-quit", () => engine?.kill());
