// The main process and the preload script, bundled for Electron: CommonJS, Electron's own modules left out - and node-pty,
// whose native part is loaded from node_modules as it is, and electron-updater, which loads its updaters lazily.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { build } from "esbuild";
import { writeNotices } from "./notices.mjs";

export async function buildElectron(options = {}) {
  await build({
    entryPoints: { main: "electron/main.ts", preload: "electron/preload.ts" },
    outdir: "dist-electron",
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron", "node-pty", "electron-updater"],
    sourcemap: true,
    ...options,
  });
}

/**
 * The third-party notices beside them: the packages' (the About sheet reads them), and Chromium's own,
 * which every build of the app must carry and the About sheet opens.
 */
export function buildNotices() {
  writeNotices();
  // Electron 44 downloads its binary when first run, not as it installs: on a fresh install - CI's - it is fetched here.
  const chromium = "node_modules/electron/dist/LICENSES.chromium.html";
  if (!existsSync(chromium)) execFileSync(process.execPath, ["node_modules/electron/install.js"], { stdio: "inherit" });
  copyFileSync(chromium, "dist-electron/LICENSES.chromium.html");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildElectron();
  buildNotices();
}
