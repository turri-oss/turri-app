import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, shell, type MenuItemConstructorOptions } from "electron";
import { execFileSync, fork, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

function readTheme(): Theme {
  try {
    const chosen = (JSON.parse(readFileSync(APPEARANCE_FILE, "utf8")) as { theme?: Theme }).theme;
    return chosen === "light" || chosen === "system" ? chosen : "dark";
  } catch {
    return "dark";
  }
}

/** The window's own colour behind the page, as the theme has it - what shows while it loads or resizes. */
function backgroundFor(): string {
  return (theme === "system" ? nativeTheme.shouldUseDarkColors : theme === "dark") ? "#0a0f1a" : "#f4f7f9";
}

function setTheme(next: Theme) {
  theme = next;
  writeFileSync(APPEARANCE_FILE, JSON.stringify({ theme }));
  // Menus, dialogs and the title bar follow it too.
  nativeTheme.themeSource = theme;
  window?.setBackgroundColor(backgroundFor());
  send("theme", theme);
  buildMenu();
}

let window: BrowserWindow | undefined;
let engine: ChildProcess | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let running = 0;

/**
 * The Node that runs the engine. turri runs its TypeScript unbuilt, which takes Node >= 22.19's type stripping:
 * Electron's own Node is not used. An app started from the Finder has no shell PATH, so the login shell is asked.
 */
function findNode(): string {
  if (process.env.TURRI_NODE) return process.env.TURRI_NODE;
  try {
    const found = execFileSync(process.env.SHELL ?? "/bin/zsh", ["-ilc", "command -v node"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").at(-1);
    if (found && existsSync(found)) return found;
  } catch {
    /* fall through to the usual places */
  }
  return ["/opt/homebrew/bin/node", "/usr/local/bin/node"].find(existsSync) ?? "node";
}

function startEngine(): Promise<void> {
  engine?.kill();
  for (const { reject } of pending.values()) reject(new Error("The engine restarted."));
  pending.clear();
  const child = fork(join(ROOT, "engine", "engine.mjs"), [], { execPath: findNode(), execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"] });
  engine = child;
  child.stdout?.on("data", (chunk) => send("engine:log", { level: "stdout", text: String(chunk) }));
  child.stderr?.on("data", (chunk) => send("engine:log", { level: "stderr", text: String(chunk) }));
  return new Promise((resolve, reject) => {
    child.on("message", (message: { id?: number; result?: unknown; error?: string; event?: string; data?: unknown }) => {
      if (message.event === "ready") return resolve();
      if (message.event !== undefined) return onEngineEvent(message.event, message.data);
      const call = pending.get(message.id!);
      if (call === undefined) return;
      pending.delete(message.id!);
      if (message.error !== undefined) call.reject(new Error(message.error));
      else call.resolve(message.result);
    });
    child.on("exit", (code) => {
      if (engine === child) engine = undefined;
      reject(new Error(`The turri engine exited (${code}). Is Node >= 22.19 on your PATH, and turri beside this app?`));
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
  await startEngine();
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

// ---------- the window ----------

function createWindow() {
  window = new BrowserWindow({
    width: 1560,
    height: 860,
    minWidth: 1100,
    minHeight: 620,
    title: "turri",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: backgroundFor(),
    show: false,
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: false },
  });
  window.once("ready-to-show", () => window?.show());
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
  window.on("closed", () => (window = undefined));
}

function buildMenu() {
  const menuAction = (action: string) => () => send("menu", action);
  const template: MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
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
        { label: "Regenerate", accelerator: "CmdOrCtrl+R", click: menuAction("regenerate"), enabled: engine !== undefined },
        { label: "Preview the Plan", accelerator: "CmdOrCtrl+Shift+P", click: menuAction("glimpse"), enabled: engine !== undefined },
        { label: "Write Conformance Tests", click: menuAction("conform"), enabled: engine !== undefined },
        { type: "separator" },
        { label: "Halt This Module", accelerator: "CmdOrCtrl+.", click: menuAction("halt"), enabled: engine !== undefined },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Spec", accelerator: "CmdOrCtrl+1", click: menuAction("view:spec") },
        { label: "Work", accelerator: "CmdOrCtrl+2", click: menuAction("view:work") },
        { label: "Code", accelerator: "CmdOrCtrl+3", click: menuAction("view:code") },
        { label: "History", accelerator: "CmdOrCtrl+4", click: menuAction("view:history") },
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
ipcMain.handle("project:open", (_event, dir: string) => openProject(dir));
ipcMain.handle("project:recents", () => recents());
ipcMain.handle("shell:reveal", (_event, path: string) => shell.showItemInFolder(path));
ipcMain.handle("shell:open", (_event, path: string) => shell.openPath(path));
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
  nativeTheme.themeSource = theme;
  buildMenu();
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on("window-all-closed", () => {
  engine?.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => engine?.kill());
