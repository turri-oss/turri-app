import { useEffect, useMemo, useState } from "react";
import type { Project, Spec } from "./types.ts";
import { Empty, Icon, Spinner } from "./ui.tsx";

type CodeFile = { path: string; rel: string; size: number };

/** The code turri regenerated for the module: a file browser over plain_modules/<module>/code, read-only. */
export function CodeView({ project, spec }: { project: Project; spec: Spec }) {
  const [listing, setListing] = useState<{ root: string; files: CodeFile[] } | null>(null);
  const [file, setFile] = useState<CodeFile | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    setListing(null);
    setFile(null);
    void window.turri.call<{ root: string; files: CodeFile[] }>("codeFiles", { module: spec.module }).then((next) => {
      setListing(next);
      setFile(next.files.find((entry) => /(^|\/)(main|app|index)\.\w+$/.test(entry.rel)) ?? next.files[0] ?? null);
    });
  }, [spec.module, project.dir]);

  useEffect(() => {
    if (file === null) return;
    setText(null);
    void window.turri.call<{ text: string }>("readCode", { path: file.path }).then(({ text }) => setText(text));
  }, [file?.path]);

  const groups = useMemo(() => {
    const byDir = new Map<string, CodeFile[]>();
    for (const entry of listing?.files ?? []) {
      if (filter && !entry.rel.toLowerCase().includes(filter.toLowerCase())) continue;
      const dir = entry.rel.includes("/") ? entry.rel.slice(0, entry.rel.lastIndexOf("/")) : "";
      byDir.set(dir, [...(byDir.get(dir) ?? []), entry]);
    }
    return [...byDir.entries()];
  }, [listing, filter]);

  if (listing === null)
    return (
      <div className="center">
        <Spinner />
      </div>
    );
  if (listing.files.length === 0)
    return (
      <Empty icon="code" title="No code yet">
        Regenerate {spec.module} and its code appears here.
      </Empty>
    );

  return (
    <div className="code-view">
      <div className="file-list">
        <input className="search" placeholder="Filter files" value={filter} onChange={(event) => setFilter(event.target.value)} />
        {groups.map(([dir, files]) => (
          <div key={dir}>
            {dir && (
              <div className="file-dir">
                <Icon name="folder" size={13} /> {dir}
              </div>
            )}
            {files.map((entry) => (
              <button key={entry.path} className={`file ${entry.path === file?.path ? "active" : ""} ${dir ? "nested" : ""}`} onClick={() => setFile(entry)}>
                {entry.rel.split("/").at(-1)}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="file-content">
        <div className="pane-header">
          <span>{file?.rel}</span>
          <span className="pane-header-right">
            {file && (
              <>
                <button className="button small" onClick={() => void window.turri.reveal(file.path)}>
                  Show in Finder
                </button>
                <button className="button small" onClick={() => void window.turri.openPath(file.path)}>
                  Open
                </button>
              </>
            )}
          </span>
        </div>
        {text === null ? (
          <div className="center">
            <Spinner />
          </div>
        ) : (
          <pre className="code">
            {text.split("\n").map((line, index) => (
              <div key={index}>
                <span className="ln">{index + 1}</span>
                {line || "​"}
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}
