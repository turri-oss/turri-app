import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { PreviewState } from "./preview.ts";
import type { TurriVersion } from "./turri-version.ts";

/** What the window may ask of the app: the engine's methods, a few native services, and the events it is sent. */
const api = {
  call: <T>(method: string, params?: unknown) => ipcRenderer.invoke("engine:call", method, params) as Promise<T>,
  chooseProject: () => ipcRenderer.invoke("project:choose"),
  newProject: () => ipcRenderer.invoke("project:new") as Promise<string | null>,
  vendors: () => ipcRenderer.invoke("project:vendors"),
  startProject: (dir: string, vendor: string, bedrock?: { maker: string; region: string }) => ipcRenderer.invoke("project:start", dir, vendor, bedrock),
  abandonProject: (dir: string) => ipcRenderer.invoke("project:abandon", dir),
  openProject: (dir: string) => ipcRenderer.invoke("project:open", dir),
  recents: () => ipcRenderer.invoke("project:recents") as Promise<string[]>,
  reveal: (path: string) => ipcRenderer.invoke("shell:reveal", path),
  openPath: (path: string) => ipcRenderer.invoke("shell:open", path),
  popup: (items: Array<{ id: string; label: string; enabled?: boolean } | { type: "separator" }>) => ipcRenderer.invoke("menu:popup", items) as Promise<string | null>,
  on: (channel: string, listener: (data: any) => void) => {
    const handler = (_event: IpcRendererEvent, data: unknown) => listener(data);
    ipcRenderer.on(channel, handler);
    return () => void ipcRenderer.off(channel, handler);
  },
  /** The preview pane: laid over a rectangle of the window, sent to an address, and moved about in. */
  preview: {
    place: (rect: { x: number; y: number; width: number; height: number } | null) => ipcRenderer.invoke("preview:place", rect),
    open: (url: string) => ipcRenderer.invoke("preview:open", url),
    go: (action: "back" | "forward" | "reload" | "stop" | "devtools") => ipcRenderer.invoke("preview:go", action),
    state: () => ipcRenderer.invoke("preview:state") as Promise<PreviewState>,
  },
  /** Which turri the app runs: from npm, or a clone's sources - and anything to do about it. */
  turriVersion: () => ipcRenderer.invoke("turri:version") as Promise<TurriVersion>,
  theme: () => ipcRenderer.invoke("theme:get") as Promise<"dark" | "light" | "system">,
  setTheme: (theme: "dark" | "light" | "system") => ipcRenderer.invoke("theme:set", theme),
  platform: process.platform,
};

contextBridge.exposeInMainWorld("turri", api);

export type TurriApi = typeof api;
