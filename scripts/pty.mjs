// node-pty, which runs the preview's terminal, ships built for each system, so it needs no compiler - but npm holds back
// its install script, which would make the helper it starts a shell with executable. Without that, every shell fails
// with "posix_spawnp failed". Run after every install; it does nothing where the helper is not there.
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const prebuilds = join(import.meta.dirname, "..", "node_modules", "node-pty", "prebuilds");
if (existsSync(prebuilds)) {
  for (const system of readdirSync(prebuilds)) {
    const helper = join(prebuilds, system, "spawn-helper");
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
}
