import { shell, WebContentsView, type BrowserWindow, type Rectangle } from "electron";

/**
 * The preview: the app turri builds, open in a browser pane of the window - a WebContentsView laid over the rectangle
 * the Preview view leaves for it. It is a page of its own: no preload, nothing of window.turri, a session of its own.
 * turri sees and tries it too, through the browser tools the engine gives its chat (engine/browser.mjs): each one a
 * request the engine sends here, done in the pane the person is looking at.
 */

export interface PreviewState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Why the page did not load - nothing answers there, say: the window shows it in the pane's place. */
  error: string | null;
}

/** Where turri's tools may go: the machine's own servers, not the web. */
export function isLocal(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (protocol === "http:" || protocol === "https:") && (["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(hostname) || hostname.endsWith(".localhost"));
  } catch {
    return false;
  }
}

/** The page's console, kept from its last load: what turri reads with browser_console. */
const CONSOLE_KEPT = 200;
/** The most of a page's text browser_read gives: a long page is cut, not sent whole. */
const TEXT_KEPT = 20000;
/** A screenshot wider than this is scaled down before turri sees it: it costs less, and reads the same. */
const SCREENSHOT_WIDTH = 1280;

/** Each pane's own browser session, kept in memory: a project opened starts with no cookies, storage or cache of another's - in any window. */
let sessions = 0;

export function createPreview({ windowOf, send }: { windowOf: () => BrowserWindow | undefined; send: (channel: string, data: unknown) => void }) {
  let view: WebContentsView | undefined;
  let shown = false;
  let error: string | null = null;
  let logs: string[] = [];
  let whenShown: Array<() => void> = [];

  const state = (): PreviewState => {
    const page = view?.webContents;
    return {
      url: page?.getURL() ?? "",
      title: page?.getTitle() ?? "",
      loading: page?.isLoading() ?? false,
      canGoBack: page?.navigationHistory.canGoBack() ?? false,
      canGoForward: page?.navigationHistory.canGoForward() ?? false,
      error,
    };
  };
  const tell = () => send("preview:state", state());

  function make(): WebContentsView {
    const made = new WebContentsView({ webPreferences: { partition: `turri-preview-${++sessions}`, sandbox: true, contextIsolation: true } });
    const page = made.webContents;
    made.setBackgroundColor("#ffffff");
    // ctrl+tab and ctrl+shift+tab in the page: the window's, to the view after the preview and the one before - the
    // window's own keys never reach it while the page has the focus.
    // ⌥⌘← and ⌥⌘→ (ctrl+alt on Linux) too: the focus to the chat, or kept in the views.
    page.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const tab = input.key === "Tab" && input.control && !input.meta && !input.alt;
      const arrow = (input.key === "ArrowLeft" || input.key === "ArrowRight") && input.alt && (process.platform === "darwin" ? input.meta : input.control);
      if (!tab && !arrow) return;
      event.preventDefault();
      if (arrow && input.key === "ArrowRight") return;
      windowOf()?.webContents.focus();
      send("menu", arrow ? "focus-chat" : input.shift ? "view-previous" : "view-next");
    });
    page.on("did-start-loading", tell);
    page.on("did-stop-loading", tell);
    page.on("page-title-updated", tell);
    page.on("did-navigate-in-page", tell);
    // A new page: its console starts again, and whatever kept the last one from loading is past.
    page.on("did-navigate", () => {
      logs = [];
      error = null;
      tell();
    });
    page.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      // -3 is a load given up for another: not a failure.
      if (!isMainFrame || code === -3) return;
      error = `${description} - ${url}`;
      logs.push(`[load failed] ${description} - ${url}`);
      tell();
    });
    page.on("console-message", (event) => {
      // Electron's own, about the pane's settings: not the app's to answer for.
      if (event.message.includes("Electron Security Warning")) return;
      logs.push(`[${event.level}] ${event.message}${event.sourceId ? ` (${event.sourceId}:${event.lineNumber})` : ""}`);
      if (logs.length > CONSOLE_KEPT) logs = logs.slice(-CONSOLE_KEPT);
    });
    // A link that opens a window: the app's own stays in the pane, anything else goes to the browser.
    page.setWindowOpenHandler(({ url }) => {
      if (isLocal(url)) void page.loadURL(url);
      else void shell.openExternal(url);
      return { action: "deny" };
    });
    return made;
  }

  /** The pane laid over this rectangle of the window - the Preview view's, in its CSS pixels - or taken away. */
  function place(rect: Rectangle | null) {
    const window = windowOf();
    if (window === undefined) return;
    if (rect === null) {
      if (view !== undefined && shown) window.contentView.removeChildView(view);
      shown = false;
      return;
    }
    view ??= make();
    // The window's zoom scales its CSS pixels; the pane is placed in the window's own.
    const zoom = window.webContents.getZoomFactor();
    view.setBounds({ x: Math.round(rect.x * zoom), y: Math.round(rect.y * zoom), width: Math.round(rect.width * zoom), height: Math.round(rect.height * zoom) });
    if (!shown) window.contentView.addChildView(view);
    shown = true;
    for (const done of whenShown.splice(0)) done();
  }

  async function open(url: string) {
    view ??= make();
    error = null;
    tell();
    try {
      await view.webContents.loadURL(url);
    } catch {
      /* did-fail-load has said why */
    }
    tell();
  }

  function go(action: "back" | "forward" | "reload" | "stop" | "devtools" | "focus") {
    const page = view?.webContents;
    if (page === undefined) return;
    if (action === "focus") page.focus();
    else if (action === "back") page.navigationHistory.goBack();
    else if (action === "forward") page.navigationHistory.goForward();
    else if (action === "stop") page.stop();
    else if (action === "devtools") page.openDevTools({ mode: "detach" });
    else if (error !== null) void open(page.getURL() || state().url);
    else page.reload();
  }

  /** Done with: a project closed for another, the window gone. Its next page starts a new pane. */
  function dispose() {
    const window = windowOf();
    // A window closing has been destroyed by now, and the pane's page may have gone with it.
    if (view !== undefined && shown && window !== undefined && !window.isDestroyed()) window.contentView.removeChildView(view);
    if (view !== undefined && !view.webContents.isDestroyed()) view.webContents.close();
    view = undefined;
    shown = false;
    error = null;
    logs = [];
    tell();
  }

  /** After a pulse lands: the page again, a moment later - its server may restart on the new code first. */
  function reloadSoon() {
    const url = view?.webContents.getURL();
    if (url) setTimeout(() => void open(url), 1500);
  }

  // ---------- what turri asks of it ----------

  /** The window shows the preview - turri works in the pane the person is looking at - and the pane is placed. */
  async function reveal() {
    send("preview:reveal", null);
    if (shown) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The preview is not showing - something covers it in the window. Ask the person to close it, then try again.")), 3000);
      whenShown.push(() => (clearTimeout(timer), resolve()));
    });
    // A frame for the pane to draw in its place.
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  function loaded(): WebContentsView {
    const url = view?.webContents.getURL();
    if (view === undefined || !url) throw new Error("Nothing is open in the preview: open the app first, with browser_navigate.");
    if (error !== null) throw new Error(`The preview did not load: ${error}. Is the app running?`);
    return view;
  }

  /** Until the page has loaded what an action started: a link followed, a form sent. */
  async function settle(page: Electron.WebContents) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!page.isLoading()) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 10000);
      page.once("did-stop-loading", () => (clearTimeout(timer), resolve()));
    });
  }

  /** What runs in the page, run: what it says it did, or why it could not - an element no longer there, say. */
  async function inPage(page: Electron.WebContents, source: string): Promise<string> {
    // As a gesture of the person's: the page treats it as theirs - a page it opens is one Back returns from.
    const said = (await page.executeJavaScript(source, true)) as { did?: string; error?: string };
    if (said.error !== undefined) throw new Error(said.error);
    return said.did ?? "";
  }

  const where = () => {
    const { url, title, error: failed } = state();
    return { url, title, ...(failed !== null ? { error: failed } : {}) };
  };

  const actions: Record<string, (params: any) => Promise<unknown>> = {
    navigate: async ({ url }: { url: string }) => {
      if (!isLocal(url)) throw new Error(`The preview opens only this machine's own servers - localhost and the like - not ${url}.`);
      await open(url);
      // An address that does not answer is shown as that, not as the pane: there is nothing to reveal.
      if (error === null) await reveal();
      return where();
    },
    screenshot: async () => {
      const page = loaded().webContents;
      await reveal();
      let image = await page.capturePage();
      if (image.getSize().width > SCREENSHOT_WIDTH) image = image.resize({ width: SCREENSHOT_WIDTH });
      return { ...where(), mimeType: "image/jpeg", data: image.toJPEG(80).toString("base64") };
    },
    read: async () => {
      const page = loaded().webContents;
      await reveal();
      return { ...where(), ...(await page.executeJavaScript(script(readPage, TEXT_KEPT))) };
    },
    console: async () => ({ ...where(), lines: [...logs] }),
    click: async ({ ref, selector }: { ref?: number; selector?: string }) => {
      const page = loaded().webContents;
      await reveal();
      const said = await inPage(page, script(clickOn, target(ref, selector)));
      await settle(page);
      return { ...where(), did: said };
    },
    type: async ({ ref, selector, text, submit }: { ref?: number; selector?: string; text: string; submit?: boolean }) => {
      const page = loaded().webContents;
      await reveal();
      const said = await inPage(page, script(typeInto, target(ref, selector), text, submit === true));
      await settle(page);
      return { ...where(), did: said };
    },
  };

  /** What the engine asks for one of turri's browser tools: done, and what came of it. */
  function request(action: string, params: unknown): Promise<unknown> {
    const run = actions[action];
    if (run === undefined) return Promise.reject(new Error(`No such preview action: ${action}`));
    return run(params ?? {});
  }

  return { place, open, go, state, dispose, reloadSoon, request };
}

/** The element an action is on: by the number browser_read gave it, or by a CSS selector. */
function target(ref: number | undefined, selector: string | undefined): string {
  if (ref !== undefined) return `[data-turri-ref="${Number(ref)}"]`;
  if (selector) return selector;
  throw new Error("Say which element: its ref from browser_read, or a CSS selector.");
}

// What runs in the page - written as functions, sent as their source: nothing here reaches the app's own code. They
// say what went wrong rather than throw it: a throw comes back from the page as no more than that it threw.

/** The page's text, and the controls on it, each numbered (data-turri-ref) for click and type to name. */
function readPage(kept: number) {
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  for (const old of document.querySelectorAll("[data-turri-ref]")) old.removeAttribute("data-turri-ref");
  const controls = [...document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [role="button"], [role="link"], [contenteditable="true"]')]
    .filter(visible)
    .slice(0, 200)
    .map((element, index) => {
      const ref = index + 1;
      element.setAttribute("data-turri-ref", String(ref));
      const tag = element.tagName.toLowerCase();
      const input = element as HTMLInputElement;
      const kind = tag === "input" ? `input[${input.type || "text"}]` : (element.getAttribute("role") ?? tag);
      const name = (element.getAttribute("aria-label") || element.innerText || input.placeholder || input.name || element.title || "").trim().replace(/\s+/g, " ").slice(0, 80);
      const value = tag === "input" || tag === "textarea" || tag === "select" ? ` value=${JSON.stringify(input.value)}` : "";
      const href = tag === "a" ? ` -> ${element.getAttribute("href")}` : "";
      return `[${ref}] ${kind}${name ? ` ${JSON.stringify(name)}` : ""}${value}${href}`;
    });
  const text = document.body?.innerText ?? "";
  return { text: text.length > kept ? `${text.slice(0, kept)}\n[... cut at ${kept} characters]` : text, controls };
}

function clickOn(selector: string) {
  const element = findElement(selector);
  if (typeof element === "string") return { error: element };
  element.scrollIntoView({ block: "center" });
  element.focus();
  element.click();
  return { did: `Clicked ${element.tagName.toLowerCase()} ${JSON.stringify((element.innerText || element.getAttribute("aria-label") || "").trim().slice(0, 60))}` };
}

/** Typed as a person would leave it: the value set the way the page's framework hears it, then input and change. */
function typeInto(selector: string, text: string, submit: boolean) {
  const element = findElement(selector);
  if (typeof element === "string") return { error: element };
  element.scrollIntoView({ block: "center" });
  element.focus();
  if (element.isContentEditable) element.textContent = text;
  else {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, text);
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  if (!submit) return { did: `Typed into ${element.tagName.toLowerCase()}` };
  const form = (element as HTMLInputElement).form;
  if (form) form.requestSubmit();
  else for (const type of ["keydown", "keypress", "keyup"]) element.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true }));
  return { did: `Typed into ${element.tagName.toLowerCase()} and submitted` };
}

/** The element a selector names - or, when there is none, why: sent to the page with clickOn and typeInto. */
function findElement(selector: string): HTMLElement | string {
  try {
    return document.querySelector<HTMLElement>(selector) ?? `Nothing on the page matches ${selector}: read the page again for its controls.`;
  } catch {
    return `${selector} is not a CSS selector.`;
  }
}

/** A function of the page's, as source to run there with these arguments - and findElement beside it, which it may use. */
function script(run: (...args: any[]) => unknown, ...args: unknown[]): string {
  return `(() => { ${findElement.toString()}; return (${run.toString()})(${args.map((arg) => JSON.stringify(arg)).join(", ")}); })()`;
}
