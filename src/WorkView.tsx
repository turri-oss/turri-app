import { useEffect, useRef, useState } from "react";
import type { Job, Status, TranscriptEntry } from "./types.ts";
import { cost, elapsed, Empty, Icon, Spinner, tokens, useTick } from "./ui.tsx";

/** The work: each codebase's plan, and every pulse - running, planned and done - opened into its agents' conversation. */
export function WorkView({ status, jobs, onStop }: { status: Status; jobs: Job[]; onStop: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const anyRunning = jobs.some((job) => job.status === "running");
  useTick(anyRunning);
  const selected = jobs.find((job) => job.id === open) ?? null;

  if (jobs.length === 0 && status.modules.length === 0)
    return (
      <Empty icon="layers" title="Nothing has run yet">
        Press Regenerate and turri plans the work into pulses and starts them. Each one shows up here, live.
      </Empty>
    );

  const total = jobs.reduce((sum, job) => sum + job.usage.cost, 0);

  return (
    <div className="work-view">
      <div className="work-list">
        {status.modules.map((module) => (
          <div key={module.module} className="module-plan">
            <div className="module-plan-head">
              <Icon name="layers" />
              <strong>{module.module}</strong>
              {module.stack && <span className="tag">{module.stack}</span>}
              {module.why && <span className="muted"> - {module.why}</span>}
            </div>
            {module.planned.length > 0 && (
              <ol className="planned">
                {module.planned.map((entry, index) => (
                  <li key={index}>
                    <span className="planned-index">{index + 1}</span>
                    {entry.planning ? <Spinner /> : <Icon name={entry.track === "conformance" ? "test" : "clock"} size={14} />}
                    <span>{entry.title}</span>
                    {entry.track === "conformance" && <span className="tag">conformance</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}

        <div className="sidebar-section inline">
          Pulses {total > 0 && <span className="muted">· ${total.toFixed(2)} so far</span>}
        </div>
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} open={job.id === open} onOpen={() => setOpen(job.id === open ? null : job.id)} onStop={() => onStop(job.id)} />
        ))}
      </div>
      {selected && <Transcript job={selected} onClose={() => setOpen(null)} />}
    </div>
  );
}

function JobCard({ job, open, onOpen, onStop }: { job: Job; open: boolean; onOpen: () => void; onStop: () => void }) {
  const icon =
    job.status === "running" ? <Spinner /> : job.status === "succeeded" ? <Icon name="check" /> : job.status === "failed" ? <Icon name="x" /> : job.status === "stopped" ? <Icon name="stop" /> : <Icon name="clock" />;
  return (
    <div className={`job ${job.status} ${open ? "open" : ""}`} onClick={onOpen}>
      <div className="job-head">
        <span className={`job-icon ${job.status}`}>{icon}</span>
        <div className="job-title">
          <strong>{job.title ?? job.summary}</strong>
          <span className="muted">
            {job.module}
            {job.pulse !== undefined ? ` · pulse ${job.pulse}` : ""} · {job.kind}
          </span>
        </div>
        <div className="job-meta">
          <span>{job.status === "queued" ? "waiting" : elapsed(job.startedAt, job.finishedAt)}</span>
          {cost(job.usage) && <span className="muted">{cost(job.usage)}</span>}
        </div>
        {(job.status === "running" || job.status === "queued") && (
          <button
            className="icon-button"
            title="Stop this pulse"
            onClick={(event) => {
              event.stopPropagation();
              onStop();
            }}
          >
            <Icon name="stop" />
          </button>
        )}
      </div>
      {job.status === "running" && (
        <div className="job-live">
          {job.stage && <div className="stage">{job.stage}</div>}
          {job.now && (
            <div className="now">
              <span className="pulse-dot" /> {job.now.label} <span className="muted">· {elapsed(job.now.since)}</span>
            </div>
          )}
          {job.building && <div className="building">Building {job.building.label}</div>}
          <ul className="activity">
            {job.activity.slice(-5).map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {job.status !== "running" && job.status !== "queued" && (job.announce ?? job.report ?? job.error) && (
        <p className={`job-report ${job.status}`}>{(job.announce ?? job.report ?? job.error ?? "").trim().slice(0, 600)}</p>
      )}
      {job.diagnosis && (
        <div className="diagnosis">
          <Icon name="spark" /> <div>{job.diagnosis}</div>
        </div>
      )}
      {job.specGaps.length > 0 && (
        <ul className="gaps">
          {job.specGaps.map((gap, index) => (
            <li key={index}>
              <strong>The spec does not say:</strong> {gap.question} <span className="muted">Meanwhile: {gap.assumption}</span>
            </li>
          ))}
        </ul>
      )}
      {job.agents.length > 0 && (
        <div className="agents">
          {job.agents.map((agent) => (
            <span key={agent.label} className="agent-chip" title={agent.model}>
              {agent.label} · {agent.turns} turn{agent.turns === 1 ? "" : "s"}
              {tokens(agent.usage) && ` · ${tokens(agent.usage)}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A pulse's agents' conversation, as chat bubbles: polled while it runs. */
function Transcript({ job, onClose }: { job: Job; onClose: () => void }) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [showThinking, setShowThinking] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    let alive = true;
    const load = () => void window.turri.call<TranscriptEntry[]>("transcript", { id: job.id }).then((next) => alive && setEntries(next));
    load();
    if (job.status !== "running") return () => void (alive = false);
    const timer = setInterval(load, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [job.id, job.status]);

  useEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: "end" });
  }, [entries]);

  return (
    <aside className="transcript">
      <div className="pane-header">
        <span>{job.title ?? job.summary}</span>
        <span className="pane-header-right">
          <label className="toggle">
            <input type="checkbox" checked={showThinking} onChange={(event) => setShowThinking(event.target.checked)} /> Thinking
          </label>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </span>
      </div>
      <div
        className="transcript-body"
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {entries.length === 0 && <p className="muted pad">Nothing said yet.</p>}
        {entries
          .filter((entry) => showThinking || entry.kind !== "thinking")
          .map((entry, index) => (
            <Entry key={index} entry={entry} />
          ))}
        <div ref={end} />
      </div>
    </aside>
  );
}

function Entry({ entry }: { entry: TranscriptEntry }) {
  const [expanded, setExpanded] = useState(false);
  switch (entry.kind) {
    case "stage":
      return <div className="t-stage">{entry.text}</div>;
    case "spec":
      return <div className="t-spec">{entry.text}</div>;
    case "diff":
      return <pre className="t-diff">{colourDiff(entry.text)}</pre>;
    case "prompt":
      return (
        <div className="t-bubble prompt" onClick={() => setExpanded(!expanded)}>
          <div className="t-who">turri → {entry.agent?.label ?? "agent"}</div>
          <div className={expanded ? "" : "clamp"}>{entry.text}</div>
        </div>
      );
    case "text":
      return (
        <div className="t-bubble reply">
          <div className="t-who">{entry.agent?.label ?? "agent"}</div>
          {entry.text}
        </div>
      );
    case "thinking":
      return <div className="t-thinking">{entry.text}</div>;
    case "tool":
      return (
        <div className="t-tool" onClick={() => setExpanded(!expanded)}>
          <Icon name="code" size={13} /> <span>{entry.text}</span>
          {expanded && entry.full && <pre>{entry.full}</pre>}
        </div>
      );
    case "result":
      return (
        <div className={`t-result ${entry.error ? "error" : ""}`} onClick={() => setExpanded(!expanded)}>
          <pre className={expanded ? "" : "clamp"}>{expanded ? (entry.full ?? entry.text) : entry.text}</pre>
        </div>
      );
  }
}

function colourDiff(text: string) {
  return text.split("\n").map((line, index) => (
    <div key={index} className={line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : line.startsWith("@@") ? "hunk" : ""}>
      {line || "​"}
    </div>
  ));
}
