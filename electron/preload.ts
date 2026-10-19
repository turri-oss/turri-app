import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

/** What the window may ask of the app: the engine's methods, a few native services, and the events it is sent. */
const api = {
  call: <T>(method: string, params?: unknown) => ipcRenderer.invoke("engine:call", method, params) as Promise<T>,
  chooseProject: () => ipcRenderer.invoke("project:choose"),
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
  theme: () => ipcRenderer.invoke("theme:get") as Promise<"dark" | "light" | "system">,
  setTheme: (theme: "dark" | "light" | "system") => ipcRenderer.invoke("theme:set", theme),
  platform: process.platform,
};

contextBridge.exposeInMainWorld("turri", api);

export type TurriApi = typeof api;
