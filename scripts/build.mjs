// The main process and the preload script, bundled for Electron: CommonJS, Electron's own modules left out - and node-pty,
// whose native part is loaded from node_modules as it is, and electron-updater, which loads its updaters lazily.
import { build } from "esbuild";

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

if (import.meta.url === `file://${process.argv[1]}`) await buildElectron();
