// The third-party notices the About sheet lists: every package the app carries - what is installed beside it
// (package.json's dependencies, and theirs) and what Vite bundles into the window - with its licence and the text of
// its licence files. Written to dist-electron/notices.json as the app is built.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
/** Bundled into the window by Vite: devDependencies by npm's word, but in the app all the same. */
const IN_THE_WINDOW = ["react", "react-dom", "markdown-it", "@xterm/xterm", "@xterm/addon-fit"];
const LICENCE_FILE = /^(licen[cs]e|copying|notice)(\.|-|$)/i;

/** Where a package is installed as `from` would find it: its own node_modules first, then each folder up. */
function locate(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dir === ROOT || dirname(dir) === dir) return undefined;
  }
}

function licenceOf(manifest) {
  if (typeof manifest.license === "string") return manifest.license;
  if (manifest.license?.type) return manifest.license.type;
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map((each) => each.type ?? each).join(" OR ");
  return "UNKNOWN";
}

export function collectNotices() {
  const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const seen = new Map();
  const walk = (name, from, deep = true) => {
    const dir = locate(name, from);
    if (dir === undefined || seen.has(dir)) return;
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const files = readdirSync(dir).filter((file) => LICENCE_FILE.test(file));
    seen.set(dir, {
      name: manifest.name ?? name,
      version: manifest.version ?? "",
      license: licenceOf(manifest),
      homepage: typeof manifest.homepage === "string" ? manifest.homepage : undefined,
      text: files.map((file) => readFileSync(join(dir, file), "utf8").trim()).join("\n\n"),
    });
    if (deep) for (const next of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) walk(next, dir);
  };
  for (const name of [...Object.keys(root.dependencies ?? {}), ...IN_THE_WINDOW]) walk(name, ROOT);
  // Electron is the app's runtime - its own dependencies only download it - and Chromium's licences ship in every build,
  // in LICENSES.chromium.html beside the app.
  walk("electron", ROOT, false);

  const packages = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  // One entry for a package installed at one version in several places.
  const unique = packages.filter((each, at) => at === 0 || each.name !== packages[at - 1].name || each.version !== packages[at - 1].version);
  return { packages: unique };
}

export function writeNotices() {
  mkdirSync(join(ROOT, "dist-electron"), { recursive: true });
  writeFileSync(join(ROOT, "dist-electron", "notices.json"), JSON.stringify(collectNotices()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeNotices();
  const { packages } = collectNotices();
  console.log(`${packages.length} packages, ${packages.filter((each) => each.text === "").length} without a licence file`);
}
