// Development: Vite serves the window with hot reload, and Electron is started on it once the main process is built.
// turri is the clone beside this one (../turri), its sources as they are, when there is one - TURRI_DEV names another,
// and TURRI_DEV=npm (npm run dev:npm) the package from npm.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import electron from "electron";
import { buildElectron } from "./build.mjs";

const server = await createServer();
await server.listen();
await buildElectron();
const url = server.resolvedUrls.local[0];
const env = { ...process.env, VITE_DEV_SERVER_URL: url };
if (env.TURRI_DEV === "npm") delete env.TURRI_DEV;
else if (env.TURRI_DEV === undefined && existsSync(resolve("../turri/src/host.ts"))) env.TURRI_DEV = resolve("../turri");
console.log(env.TURRI_DEV ? `turri from the clone at ${env.TURRI_DEV}` : "turri from npm (@turri-dev/cli)");
const app = spawn(electron, ["."], { stdio: "inherit", env });
app.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
