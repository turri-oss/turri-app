import { useEffect, useState } from "react";
import type { Project, Spec } from "./types.ts";
import { colourDiff } from "./WorkView.tsx";
import { Empty, Icon, relativeDate, Spinner } from "./ui.tsx";

type Commit = { hash: string; date: string; subject: string; body: string };

/** The module's lineage: every unit of work that landed, as .plaingit records it, with what it changed. */
export function HistoryView({ project, spec }: { project: Project; spec: Spec }) {
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);

  useEffect(() => {
    setCommits(null);
    setOpen(null);
    void window.turri.call<Commit[]>("lineage", { module: spec.module }).then((next) => {
      setCommits(next);
      setOpen(next[0]?.hash ?? null);
    });
  }, [spec.module, project.dir]);

  useEffect(() => {
    if (open === null) return;
    setDiff(null);
    void window.turri.call<string>("commitDiff", { module: spec.module, hash: open }).then(setDiff);
  }, [open, spec.module]);

  if (commits === null)
    return (
      <div className="center">
        <Spinner />
      </div>
    );
  if (commits.length === 0)
    return (
      <Empty icon="branch" title="No history yet">
        Every pulse that lands is committed to the module's lineage, and shows up here.
      </Empty>
    );

  return (
    <div className="history-view">
      <ol className="timeline">
        {commits.map((commit) => (
          <li key={commit.hash} className={open === commit.hash ? "active" : ""} onClick={() => setOpen(commit.hash)}>
            <span className="timeline-dot" />
            <div>
              <div className="commit-subject">{commit.subject.replace(/^spec diff: /, "")}</div>
              <div className="muted">
                {relativeDate(commit.date)} · <code>{commit.hash.slice(0, 7)}</code>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="commit-detail">
        {open === null ? (
          <Empty icon="branch" title="Choose a change">
            See what each pulse changed in the code, its tests and its spec.
          </Empty>
        ) : diff === null ? (
          <div className="center">
            <Spinner />
          </div>
        ) : (
          <pre className="t-diff full">{colourDiff(diff)}</pre>
        )}
      </div>
    </div>
  );
}
