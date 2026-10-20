import { useEffect, useRef, useState } from "react";
import type { Job, Status, TranscriptEntry } from "./types.ts";
import { cost, elapsed, Empty, Icon, Spinner, tokens, useTick } from "./ui.tsx";
import { hasSpecPart, PulseSpec, stageOf, turriSays } from "./PulseSpec.tsx";
import { Prose } from "./Chat.tsx";

/** The work: each codebase's plan, and every pulse - running, planned and done - opened into its agents' conversation. */
export function WorkView({
  status,
  jobs,
  onShowInSpec,
  focus,
}: {
  status: Status;
  jobs: Job[];
  onShowInSpec: (file: string, lines: number[]) => void;
  /** A pulse to open and bring into view - one the chat says ended. */
  focus?: { id: string; at: number };
}) {
  const [open, setOpen] = useState<string | null>(focus?.id ?? null);
  useEffect(() => {
    if (focus === undefined) return;
    setOpen(focus.id);
    requestAnimationFrame(() => document.querySelector(`.job[data-id="${CSS.escape(focus.id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, [focus?.at]);
  const anyRunning = jobs.some((job) => job.status === "running");
  useTick(anyRunning);
  const selected = jobs.find((job) => job.id === open) ?? null;

  if (jobs.length === 0 && status.modules.length === 0)
    return (
      <Empty icon="layers" title="nothing has run yet">
        press regenerate and turri plans the work into pulses and starts them. each one shows up here, live.
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
              {module.why && <span className="muted"> - {turriSays(module.why)}</span>}
            </div>
            {module.planned.length > 0 && (
              <ol className="planned">
                {module.planned.map((entry, index) => (
                  <li key={index} className={entry.track === "conformance" ? "conformance" : "regenerate"}>
                    <span className="planned-index">{index + 1}</span>
                    {entry.planning ? <Spinner /> : <Icon name={entry.track === "conformance" ? "test" : "clock"} size={14} />}
                    <span>{entry.title}</span>
                    <span className="kind-tag">{entry.track === "conformance" ? "conformance" : "regenerate"}</span>
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
          <JobCard key={job.id} job={job} open={job.id === open} onOpen={() => setOpen(job.id === open ? null : job.id)} />
        ))}
      </div>
      {selected && <Transcript key={selected.id} job={selected} onClose={() => setOpen(null)} onShowInSpec={onShowInSpec} />}
    </div>
  );
}

function JobCard({ job, open, onOpen }: { job: Job; open: boolean; onOpen: () => void }) {
  // What a pulse that ended reports, and what it found the spec does not say: each folded, to open and read - the card
  // says how it went without them.
  const [reading, setReading] = useState<"report" | "gaps" | null>(null);
  const toggle = (what: "report" | "gaps") => setReading((now) => (now === what ? null : what));
  const gaps = job.specGaps.length;
  const report = job.status !== "running" && job.status !== "queued" ? (job.announce ?? job.report ?? job.error ?? "").trim() : "";
  // Its kind, coloured as the intent view marks it: a regenerate pulse pink, as a built functional spec; a conformance
  // pulse turri's cyan, as a conformance-tested one - two ticks when it lands.
  const kind = job.kind === "conformance" ? "conformance" : "regenerate";
  const icon =
    job.status === "running" ? (
      <Spinner />
    ) : job.status === "succeeded" ? (
      <Icon name={kind === "conformance" ? "checks" : "check"} />
    ) : job.status === "failed" ? (
      <Icon name="x" />
    ) : job.status === "stopped" ? (
      <Icon name="stop" />
    ) : (
      <Icon name="clock" />
    );
  return (
    <div className={`job ${kind} ${job.status} ${open ? "open" : ""}`} data-id={job.id} onClick={onOpen}>
      <div className="job-head">
        <span className={`job-icon ${job.status}`}>{icon}</span>
        <div className="job-title">
          <strong>{job.title ?? job.summary}</strong>
          <span className="muted">
            {job.module}
            {job.pulse !== undefined ? ` · pulse ${job.pulse}` : ""} <span className="kind-tag">{job.kind}</span>
          </span>
        </div>
        <div className="job-meta">
          <span>{job.status === "queued" ? "waiting" : elapsed(job.startedAt, job.finishedAt)}</span>
          {cost(job.usage) && <span className="muted">{cost(job.usage)}</span>}
        </div>
      </div>
      {job.status === "running" && (
        <div className="job-live">
          {stageOf(job) && <div className="stage">{stageOf(job)}</div>}
          {job.now && (
            <div className="now">
              <span className="pulse-dot" /> {turriSays(job.now.label)} <span className="muted">· {elapsed(job.now.since)}</span>
            </div>
          )}
          {job.building && <div className="building">building {turriSays(job.building.label)}</div>}
          <ul className="activity">
            {job.activity.slice(-5).map((line, index) => (
              <li key={index}>{turriSays(line)}</li>
            ))}
          </ul>
        </div>
      )}
      {(report !== "" || gaps > 0) && (
        <div className={`job-report ${job.status}`} onClick={(event) => event.stopPropagation()}>
          <div className="job-report-toggles">
            {report !== "" && (
              <button className="link job-report-toggle" onClick={() => toggle("report")} aria-expanded={reading === "report"}>
                <Icon name="chevron" size={12} /> {job.status === "failed" ? "why it failed" : "report"}
              </button>
            )}
            {gaps > 0 && (
              <button className="link job-report-toggle gaps-toggle" onClick={() => toggle("gaps")} aria-expanded={reading === "gaps"}>
                <Icon name="chevron" size={12} /> <span className="gaps-count">{gaps}</span> spec gap{gaps === 1 ? "" : "s"}
              </button>
            )}
          </div>
          {reading === "report" && <Prose text={report} />}
          {reading === "gaps" && (
            <ul className="gaps">
              {job.specGaps.map((gap, index) => (
                <li key={index}>
                  <div>
                    <strong>the spec does not say:</strong> {gap.question}
                  </div>
                  <div className="muted">Meanwhile, the pulse assumed: {gap.assumption}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {job.diagnosis && (
        <div className="diagnosis">
          <Icon name="spark" /> <div>{job.diagnosis}</div>
        </div>
      )}
      {job.agents.length > 0 && (
        <div className="agents">
          {job.agents.map((agent) => (
            <span key={agent.label} className="agent-chip" title={agent.model}>
              {turriSays(agent.label)} · {agent.turns} turn{agent.turns === 1 ? "" : "s"}
              {tokens(agent.usage) && ` · ${tokens(agent.usage)}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A pulse, opened: the ***plain it works on - what it renders, coloured as the spec is - and its agents' conversation,
 * as chat bubbles, polled while it runs.
 */
function Transcript({ job, onClose, onShowInSpec }: { job: Job; onClose: () => void; onShowInSpec: (file: string, lines: number[]) => void }) {
  const [tab, setTab] = useState<"spec" | "conversation">(hasSpecPart(job) ? "spec" : "conversation");
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
      <div className="pane-header transcript-head">
        <div className="segmented transcript-tabs" role="tablist">
          {(["spec", "conversation"] as const).map((name) => (
            <button key={name} role="tab" aria-selected={tab === name} className={tab === name ? "on" : ""} onClick={() => setTab(name)}>
              {name}
            </button>
          ))}
        </div>
        <span className="pane-header-right">
          {tab === "conversation" && (
            <label className="toggle">
              <input type="checkbox" checked={showThinking} onChange={(event) => setShowThinking(event.target.checked)} /> thinking
            </label>
          )}
          <button className="icon-button" onClick={onClose} aria-label="close">
            <Icon name="x" />
          </button>
        </span>
      </div>
      {tab === "spec" ? (
        <div className="transcript-body">
          <PulseSpec job={job} onShowInSpec={onShowInSpec} />
        </div>
      ) : (
      <div
        className="transcript-body"
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {entries.length === 0 && <p className="muted pad">nothing said yet.</p>}
        {entries
          .filter((entry) => showThinking || entry.kind !== "thinking")
          .map((entry, index) => (
            <Entry key={index} entry={entry} />
          ))}
        <div ref={end} />
      </div>
      )}
    </aside>
  );
}

function Entry({ entry }: { entry: TranscriptEntry }) {
  const [expanded, setExpanded] = useState(false);
  switch (entry.kind) {
    case "stage":
      return <div className="t-stage">{turriSays(entry.text)}</div>;
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
