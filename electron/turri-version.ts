import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Which turri the app runs, said in the window: the package from npm, the version package.json pins - or a clone's
 * own sources (TURRI_DEV, which `npm run dev` sets to ../turri when there is one), at whatever commit it is on. A
 * clone without the commit the pinned version was published from is behind what this app is built against; a package
 * that is not the pinned version wants npm install. Either is said, not refused: working on another turri on purpose
 * goes on working.
 */
export interface TurriVersion {
  from: "npm" | "clone";
  /** What the window says: `0.1.8-next.e553476`, or `main @ e553476`. */
  label: string;
  /** More, on hover: where it is, what is pinned, what is not committed. */
  detail: string;
  /** Something to do about it, if anything. */
  warning?: string;
}

const git = (dir: string, ...args: string[]): string | undefined => {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
};

export function turriVersion(root: string): TurriVersion {
  const pinned = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string> }).dependencies?.["@turri-dev/cli"] ?? "";
  // A prerelease is versioned from the commit it was published from: 0.1.8-next.e553476.
  const pinnedCommit = /-next\.([0-9a-f]{7,})$/.exec(pinned)?.[1];
  const clone = process.env.TURRI_DEV;

  if (clone === undefined || clone === "" || clone === "npm") {
    let installed: string | undefined;
    try {
      installed = (JSON.parse(readFileSync(join(root, "node_modules", "@turri-dev", "cli", "package.json"), "utf8")) as { version: string }).version;
    } catch {
      /* not installed */
    }
    return {
      from: "npm",
      label: installed ?? "not installed",
      detail: `@turri-dev/cli ${installed ?? "-"} from npm - package.json pins ${pinned}`,
      ...(installed === undefined
        ? { warning: "turri is not installed: run npm install" }
        : installed !== pinned
          ? { warning: `npm installed ${installed}, but package.json pins ${pinned}: run npm install` }
          : {}),
    };
  }

  const dir = resolve(clone);
  if (!existsSync(join(dir, "src", "host.ts"))) return { from: "clone", label: "not a turri clone", detail: dir, warning: `TURRI_DEV=${clone} is not a turri clone` };
  const commit = git(dir, "rev-parse", "--short=7", "HEAD");
  const branch = git(dir, "branch", "--show-current") || "detached";
  const changed = git(dir, "status", "--porcelain")?.split("\n").filter(Boolean).length ?? 0;
  // Has the clone the commit the pinned version was published from? 0 yes, 1 no; anything else - a commit it has never
  // fetched - is no as well.
  let behind = false;
  if (pinnedCommit !== undefined && commit !== undefined) {
    try {
      execFileSync("git", ["-C", dir, "merge-base", "--is-ancestor", pinnedCommit, "HEAD"], { timeout: 3000, stdio: "ignore" });
    } catch {
      behind = true;
    }
  }
  return {
    from: "clone",
    label: `${branch} @ ${commit ?? "?"}${changed > 0 ? ` · ${changed} uncommitted` : ""}`,
    detail: `the turri clone at ${dir} - its sources, as they are on disk${pinned ? `; package.json pins ${pinned}` : ""}`,
    ...(behind ? { warning: `your turri clone is behind what this app pins (${pinnedCommit}): git pull and npm install in it, or npm run dev:npm` } : {}),
  };
}
