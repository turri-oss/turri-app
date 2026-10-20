import { useCallback, useEffect, useRef, useState } from "react";
import type { Spec } from "./types.ts";
import { Icon, Spinner } from "./ui.tsx";

export interface FileEntry {
  name: string;
  path: string;
  dir: boolean;
}

/** Folders turri and its pulses keep for themselves: listed, but quieter than what the person writes. */
const QUIET = new Set(["plain_modules", "dist"]);
const OPEN_KEY = "turri-app.tree-open";

function savedOpen(dir: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(`${OPEN_KEY}:${dir}`) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function parentOf(path: string) {
  return path.slice(0, path.lastIndexOf("/"));
}

/**
 * Everything in the project, as a tree: the specs with their state beside them, and the templates they import, the
 * test scripts, resources, readmes, skills - each folder listed when it is opened, and again when what is in it changes.
 * Which folders are open is kept between launches, project by project.
 */
export function FileTree(props: { root: string; specs: Spec[]; selected: string | null; isRunning: (module: string) => boolean; onSelect: (path: string) => void }) {
  const { root } = props;
  const [listed, setListed] = useState<Map<string, FileEntry[]>>(new Map());
  const [open, setOpen] = useState<Set<string>>(() => savedOpen(root));
  const listedRef = useRef(listed);
  listedRef.current = listed;

  const list = useCallback(async (dir: string) => {
    const entries = await window.turri.call<FileEntry[] | null>("listFiles", { dir }).catch(() => null);
    if (entries) setListed((all) => new Map(all).set(dir, entries));
    else {
      // Gone: a folder deleted while open, or left open in a project since reset, is simply not listed.
      setListed((all) => {
        const next = new Map(all);
        next.delete(dir);
        return next;
      });
    }
  }, []);

  // The project and the folders left open last time.
  useEffect(() => {
    setListed(new Map());
    const opened = savedOpen(root);
    setOpen(opened);
    void list(root);
    for (const dir of opened) void list(dir);
  }, [root, list]);

  useEffect(() => {
    try {
      localStorage.setItem(`${OPEN_KEY}:${root}`, JSON.stringify([...open]));
    } catch {
      /* not kept: the folders start closed next time */
    }
  }, [root, open]);

  // Something changed on disk: the folders it changed in, that are listed, are listed again.
  useEffect(
    () =>
      window.turri.on("engine:files", ({ paths }: { paths: string[] }) => {
        const dirs = new Set(paths.flatMap((path) => [parentOf(path), path]).filter((dir) => listedRef.current.has(dir)));
        for (const dir of dirs) void list(dir);
      }),
    [list],
  );

  const toggle = (dir: string) => {
    const next = new Set(open);
    if (next.has(dir)) next.delete(dir);
    else {
      next.add(dir);
      if (!listed.has(dir)) void list(dir);
    }
    setOpen(next);
  };

  const menu = async (entry: FileEntry) => {
    const chosen = await window.turri.popup([
      ...(entry.dir ? [] : [{ id: "open", label: "open with default app" }]),
      { id: "reveal", label: "reveal in Finder" },
      { type: "separator" as const },
      { id: "copy", label: "copy path" },
      { id: "copy-rel", label: "copy relative path" },
    ]);
    if (chosen === "open") void window.turri.openPath(entry.path);
    else if (chosen === "reveal") void window.turri.reveal(entry.path);
    else if (chosen === "copy") void navigator.clipboard.writeText(entry.path);
    else if (chosen === "copy-rel") void navigator.clipboard.writeText(entry.path.slice(root.length + 1));
  };

  const rows = (dir: string, depth: number, quiet: boolean): React.ReactNode => {
    const entries = listed.get(dir);
    if (entries === undefined) return null;
    if (entries.length === 0) return <div className="tree-empty" style={{ "--depth": depth } as React.CSSProperties}>empty</div>;
    return entries.map((entry) => {
      const muted = quiet || entry.name.startsWith(".") || (depth === 0 && QUIET.has(entry.name));
      const spec = entry.dir ? undefined : props.specs.find((candidate) => candidate.file === entry.path);
      const isOpen = entry.dir && open.has(entry.path);
      return (
        <div key={entry.path} role="treeitem" aria-expanded={entry.dir ? isOpen : undefined} aria-selected={entry.path === props.selected}>
          <button
            className={`tree-row ${entry.path === props.selected ? "active" : ""} ${muted ? "quiet" : ""}`}
            style={{ "--depth": depth } as React.CSSProperties}
            title={entry.path.slice(root.length + 1)}
            onClick={() => (entry.dir ? toggle(entry.path) : props.onSelect(entry.path))}
            onContextMenu={(event) => {
              event.preventDefault();
              void menu(entry);
            }}
          >
            {entry.dir ? <span className={`chevron ${isOpen ? "open" : ""}`}><Icon name="chevron" size={12} /></span> : <span className="chevron" />}
            {spec ? <SpecState spec={spec} running={props.isRunning(spec.module)} /> : <Icon name={entry.dir ? "folder" : entry.name.endsWith(".plain") ? "doc" : "file"} size={14} />}
            <span className="tree-name">{entry.name}</span>
            {spec && <span className="spec-row-count">{spec.ok ? `${spec.functionalSpecs.filter((entry) => entry.built).length}/${spec.functionalSpecs.length}` : "!"}</span>}
          </button>
          {isOpen && <div role="group">{rows(entry.path, depth + 1, muted)}</div>}
        </div>
      );
    });
  };

  return (
    <nav className="tree" role="tree">
      {listed.has(root) ? rows(root, 0, false) : <Spinner />}
    </nav>
  );
}

/** A spec's state: up to date and conformance tested, up to date, still to regenerate, not built, being regenerated, or not parsing. */
function SpecState({ spec, running }: { spec: Spec; running: boolean }) {
  const total = spec.functionalSpecs.length;
  const built = spec.functionalSpecs.filter((entry) => entry.built).length;
  const done = total > 0 && built === total && !spec.drifted;
  const conformed = done && spec.functionalSpecs.every((entry) => entry.conformed);
  const state = !spec.ok ? "error" : running ? "running" : conformed ? "conformed" : done ? "done" : built > 0 ? "partial" : "new";
  const label = { error: "does not parse", running: "regenerating", conformed: "up to date and conformance tested", done: "up to date", partial: "to regenerate", new: "not built" }[state];
  return (
    <span className="tree-state" title={label}>
      <span className={`state-dot ${state}`}>{state === "running" ? <Spinner /> : null}</span>
    </span>
  );
}
