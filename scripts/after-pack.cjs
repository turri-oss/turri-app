// node_modules as npm installed it, into the app packaged - before it is signed. electron-builder's own collector
// hoists the tree again its own way, and drops what it does not follow: a package only another's peer dependency
// (@langchain/core, langgraph's) and the versions nested under the one that needs them (pi's typebox and undici) -
// so the engine stops at an import, or runs on a version its code was not written for. So electron-builder.yml leaves
// node_modules out, and this copies every package `npm ls --omit=dev` lists, nested ones where npm put them.
const { execFileSync } = require("node:child_process");
const { cpSync, existsSync, rmSync } = require("node:fs");
const { join, relative, sep } = require("node:path");

// What of node-pty runs nowhere here: its sources, winpty, the Windows prebuilds.
const SKIP = new Set(["deps", "src", "third_party", "scripts", "binding.gyp"].map((name) => join("node-pty", name)));

exports.default = async function afterPack(context) {
  const root = context.packager.projectDir;
  const resources =
    context.electronPlatformName === "darwin"
      ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : join(context.appOutDir, "resources");
  const into = join(resources, "app", "node_modules");

  let listed;
  try {
    listed = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // npm ls says so when the tree has anything extraneous, and lists it all the same.
    listed = error.stdout;
  }
  // The packages at the top of node_modules: each is copied whole, with the node_modules nested in it.
  const top = new Set();
  for (const path of listed.split("\n").filter(Boolean)) {
    const inside = relative(join(root, "node_modules"), path);
    if (inside === "" || inside.startsWith("..")) continue;
    const parts = inside.split(sep);
    top.add(parts[0].startsWith("@") ? join(parts[0], parts[1]) : parts[0]);
  }

  rmSync(into, { recursive: true, force: true });
  for (const name of top) {
    const from = join(root, "node_modules", name);
    if (!existsSync(from)) continue;
    cpSync(from, join(into, name), {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => {
        const inside = relative(join(root, "node_modules"), source);
        return !SKIP.has(inside) && !inside.includes(join("node-pty", "prebuilds", "win32-")) && !inside.split(sep).includes(".bin");
      },
    });
  }
  console.log(`  • copied node_modules  packages=${top.size} into=${relative(root, into)}`);
};
