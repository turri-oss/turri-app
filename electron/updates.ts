import { app } from "electron";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import electronUpdater from "electron-updater";

/**
 * The app's own updates, from its releases on GitHub (electron-builder.yml's publish): checked as it starts and every
 * few hours, downloaded on their own, and installed on a restart the person chooses - or when the app next quits. turri
 * comes with the app, pinned, so a new turri is a new app.
 *
 * Only as installed, and on macOS only when signed with a Developer ID: Squirrel.Mac takes an update only from the
 * same signer, and an app signed ad hoc has none. On Linux the AppImage and the .deb update themselves.
 */
export type UpdateState =
  | { status: "off"; reason: string }
  | { status: "idle" }
  | { status: "checking" }
  | { status: "downloading"; version: string; percent: number }
  | { status: "ready"; version: string }
  | { status: "failed"; error: string };

const { autoUpdater } = electronUpdater;
const EVERY = 4 * 60 * 60 * 1000;

/** Why this app cannot update itself, if it cannot. */
function cannotUpdate(): string | undefined {
  if (!app.isPackaged) return "run from source, the app is updated with git pull";
  if (process.platform !== "darwin") return undefined;
  // The bundle: turri.app, three folders up from Contents/MacOS/turri.
  const bundle = join(app.getPath("exe"), "..", "..", "..");
  const signed = spawnSync("codesign", ["-dv", "--verbose=2", bundle], { encoding: "utf8" }).stderr ?? "";
  return /Authority=Developer ID Application/.test(signed) ? undefined : "this build is not signed with a Developer ID, which macOS needs to update it";
}

export function createUpdates({ onChange }: { onChange: (state: UpdateState) => void }) {
  const reason = cannotUpdate();
  let state: UpdateState = reason === undefined ? { status: "idle" } : { status: "off", reason };
  const set = (next: UpdateState) => {
    state = next;
    onChange(state);
  };

  if (reason === undefined) {
    autoUpdater.logger = console;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () => state.status !== "ready" && set({ status: "checking" }));
    autoUpdater.on("update-not-available", () => state.status !== "ready" && set({ status: "idle" }));
    autoUpdater.on("update-available", (info) => set({ status: "downloading", version: info.version, percent: 0 }));
    autoUpdater.on("download-progress", (progress) => state.status === "downloading" && set({ ...state, percent: Math.round(progress.percent) }));
    autoUpdater.on("update-downloaded", (info) => set({ status: "ready", version: info.version }));
    autoUpdater.on("error", (error) => state.status !== "ready" && set({ status: "failed", error: error.message }));
  }

  /** Asks GitHub for a newer release; one found is downloaded on its own. */
  async function check(): Promise<UpdateState> {
    if (state.status === "off" || state.status === "ready" || state.status === "downloading") return state;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      set({ status: "failed", error: (error as Error).message });
    }
    return state;
  }

  return {
    state: () => state,
    check,
    /** Checks now - a while after the app starts, so opening a project comes first - and every few hours after. */
    start() {
      if (state.status === "off") return;
      setTimeout(() => void check(), 10_000);
      setInterval(() => void check(), EVERY);
    },
    /** Quits, installs the update downloaded, and starts again. */
    install() {
      if (state.status === "ready") autoUpdater.quitAndInstall();
    },
  };
}
