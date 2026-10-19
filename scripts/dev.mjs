// Development: Vite serves the window with hot reload, and Electron is started on it once the main process is built.
import { spawn } from "node:child_process";
import { createServer } from "vite";
import electron from "electron";
import { buildElectron } from "./build.mjs";

const server = await createServer();
await server.listen();
await buildElectron();
const url = server.resolvedUrls.local[0];
const app = spawn(electron, ["."], { stdio: "inherit", env: { ...process.env, VITE_DEV_SERVER_URL: url } });
app.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
