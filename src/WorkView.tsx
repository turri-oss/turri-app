import { useEffect, useRef, useState } from "react";
import type { Failure, Job, PastPulse, PastRun, Status, TranscriptEntry } from "./types.ts";
import { cost, elapsed, Empty, Icon, PlainName, Spinner, tokens, useTick, withPlain } from "./ui.tsx";
import { hasSpecPart, PulseSpec, stageOf, turriSays } from "./PulseSpec.tsx";
import { Prose } from "./Chat.tsx";

/** Earlier sessions' runs shown at first: the last few, and more on asking. */
const RUNS_SHOWN = 3;

/** The most of a pulse's summary its card heads with: in words, and in characters. */
const SUMMARY_WORDS = 10;
const SUMMARY_CHARS = 70;

/** A pulse's summary as its card heads with it - cut at a word, with an ellipsis - the whole of it on hover and copied. */
export function short(text: string): string {
  const words = text.trim().split(/\s+/);
  let cut = words.slice(0, SUMMARY_WORDS).join(" ");
  if (words.length <= SUMMARY_WORDS && cut.length <= SUMMARY_CHARS) return cut;
  if (cut.length > SUMMARY_CHARS - 1) cut = cut.slice(0, SUMMARY_CHARS - 1).replace(/\s+\S*$/, "") || cut.slice(0, SUMMARY_CHARS - 1);
  return `${cut.replace(/[\s,.;:-]+$/, "")}…`;
}

/** A click on a card opens it - unless it ended a drag that selected some of its text, to copy. */
function opens(): boolean {
  return window.getSelection()?.isCollapsed !== false;
}

/** What is copied of a pulse: its summary whole, and, for the chat, what turri looks it up by. */
interface Copyable {
  id: string;
  summary: string;
  module?: string | null;
  pulse?: number | null;
  kind: string;
}

/** A pulse said for the chat: its summary, then its module, number, kind and id - turri finds it by the id. */
function forChat({ id, summary, module, pulse, kind }: Copyable): string {
  return `${summary} (${[module, pulse !== undefined && pulse !== null ? `pulse ${pulse}` : null, kind, id].filter(Boolean).join(" · ")})`;
}

/** Copy a pulse - from its button or a right-click: the text selected in it, for the chat, its summary, or its id. */
async function copyMenu(event: React.MouseEvent, pulse: Copyable) {
  event.preventDefault();
  event.stopPropagation();
  const selected = window.getSelection()?.toString().trim() ?? "";
  const chosen = await window.turri.popup([
    ...(selected !== "" ? [{ id: "selection", label: "copy selection" }, { type: "separator" as const }] : []),
    { id: "chat", label: "copy for the chat" },
    { id: "summary", label: "copy summary" },
    { id: "id", label: "copy pulse id" },
  ]);
  const text = chosen === "selection" ? selected : chosen === "chat" ? forChat(pulse) : chosen === "summary" ? pulse.summary : chosen === "id" ? pulse.id : null;
  if (text !== null) void navigator.clipboard.writeText(text);
}

function CopyButton({ pulse }: { pulse: Copyable }) {
  return (
    <button className="job-copy" title="copy - for the chat, its summary, or its id" aria-label="copy" onClick={(event) => void copyMenu(event, pulse)}>
      <Icon name="copy" size={14} />
    </button>
  );
}

/**
 * The work: each codebase's plan, and every pulse - running, planned and done - opened into its agents' conversation;
 * below them, earlier sessions' pulses, from the ledger, opened into what it says of each.
 */
export function WorkView({
  status,
  jobs,
  earlier,
  onShowInSpec,
  focus,
}: {
  status: Status;
  jobs: Job[];
  earlier: PastRun[];
  onShowInSpec: (file: string, lines: number[]) => void;
  /** A pulse to open and bring into view - one the chat says ended. */
  focus?: { id: string; at: number };
}) {
  const [open, setOpen] = useState<string | null>(focus?.id ?? null);
  const [runsShown, setRunsShown] = useState(RUNS_SHOWN);
  useEffect(() => {
    if (focus === undefined) return;
    setOpen(focus.id);
    // An earlier pulse in a run not shown yet: the runs down to it are.
    const run = earlier.findIndex((entry) => entry.pulses.some((pulse) => pulse.id === focus.id));
    if (run >= runsShown) setRunsShown(run + 1);
    requestAnimationFrame(() => document.querySelector(`.job[data-id="${CSS.escape(focus.id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, [focus?.at]);
  const anyRunning = jobs.some((job) => job.status === "running");
  useTick(anyRunning);
  const selected = jobs.find((job) => job.id === open) ?? null;
  const past = selected === null ? (earlier.flatMap((run) => run.pulses).find((pulse) => pulse.id === open) ?? null) : null;

  if (jobs.length === 0 && status.modules.length === 0 && earlier.length === 0)
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
              {module.why && <span className="muted"> - {withPlain(turriSays(module.why))}</span>}
            </div>
            {module.planned.length > 0 && (
              <ol className="planned">
                {module.planned.map((entry, index) => (
                  <li key={index} className={entry.track === "conformance" ? "conformance" : "regenerate"}>
                    <span className="planned-index">{index + 1}</span>
                    {entry.planning ? <Spinner /> : <Icon name={entry.track === "conformance" ? "test" : "clock"} size={14} />}
                    <span title={entry.title}>{short(entry.title)}</span>
                    <span className="kind-tag">{entry.track === "conformance" ? "conformance" : "regenerate"}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}

        {(jobs.length > 0 || earlier.length === 0) && (
          <div className="sidebar-section inline">
            Pulses {total > 0 && <span className="muted">· ${total.toFixed(2)} so far</span>}
          </div>
        )}
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} open={job.id === open} onOpen={() => setOpen(job.id === open ? null : job.id)} />
        ))}

        {earlier.length > 0 && <div className="sidebar-section inline">earlier sessions</div>}
        {earlier.slice(0, runsShown).map((run) => (
          <div key={run.run} className="past-run">
            <div className="past-run-head">
              <span>{when(run.started)}</span>
              <span className="muted">· {MODES[run.mode ?? ""] ?? run.mode ?? "run"}</span>
              {run.version && <span className="muted">· turri {run.version}</span>}
              {runCost(run) && <span className="muted">· {runCost(run)}</span>}
            </div>
            {run.pulses.map((pulse) => (
              <PastPulseCard key={pulse.id} pulse={pulse} open={pulse.id === open} onOpen={() => setOpen(pulse.id === open ? null : pulse.id)} />
            ))}
          </div>
        ))}
        {earlier.length > runsShown && (
          <button className="link past-more" onClick={() => setRunsShown((now) => now + 5)}>
            <Icon name="chevron" size={12} /> show earlier runs <span className="muted">· {earlier.length - runsShown} more</span>
          </button>
        )}
      </div>
      {selected && <Transcript key={selected.id} job={selected} onClose={() => setOpen(null)} onShowInSpec={onShowInSpec} />}
      {past && <PastPulseDetail key={past.id} pulse={past} onClose={() => setOpen(null)} />}
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
  const copyable: Copyable = { id: job.id, summary: job.title ?? job.summary, module: job.module, pulse: job.pulse, kind: job.kind };
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
    <div className={`job ${kind} ${job.status} ${open ? "open" : ""}`} data-id={job.id} onClick={() => opens() && onOpen()} onContextMenu={(event) => void copyMenu(event, copyable)}>
      <div className="job-head">
        <span className={`job-icon ${job.status}`}>{icon}</span>
        <div className="job-title">
          <strong title={copyable.summary}>{short(copyable.summary)}</strong>
          <span className="muted">
            {job.module}
            {job.pulse !== undefined ? ` · pulse ${job.pulse}` : ""} <span className="kind-tag">{job.kind}</span>
          </span>
        </div>
        <div className="job-meta">
          <span>{job.status === "queued" ? "waiting" : elapsed(job.startedAt, job.finishedAt)}</span>
          {cost(job.usage) && <span className="muted">{cost(job.usage)}</span>}
        </div>
        <CopyButton pulse={copyable} />
      </div>
      {job.status === "running" && (
        <div className="job-live">
          {stageOf(job) && <div className="stage">{stageOf(job)}</div>}
          {job.now && (
            <div className="now">
              <span className="pulse-dot" /> {withPlain(turriSays(job.now.label))} <span className="muted">· {elapsed(job.now.since)}</span>
            </div>
          )}
          {job.building && <div className="building">building {withPlain(turriSays(job.building.label))}</div>}
          <ul className="activity">
            {job.activity.slice(-5).map((line, index) => (
              <li key={index}>{withPlain(turriSays(line))}</li>
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
                <Icon name="chevron" size={12} /> <span className="gaps-count">{gaps}</span> <PlainName /> gap{gaps === 1 ? "" : "s"}
              </button>
            )}
          </div>
          {reading === "report" && <Prose text={report} />}
          {reading === "gaps" && (
            <ul className="gaps">
              {job.specGaps.map((gap, index) => (
                <li key={index}>
                  <div>
                    <strong>the <PlainName /> does not say:</strong> {gap.question}
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
      <FailureMarks failures={job.failures} />
      {job.agents.length > 0 && (
        <div className="agents">
          {job.agents.map((agent) => (
            <span key={agent.label} className="agent-chip" title={agent.model}>
              {withPlain(turriSays(agent.label))} · {agent.turns} turn{agent.turns === 1 ? "" : "s"}
              {tokens(agent.usage) && ` · ${tokens(agent.usage)}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** What failed in a pulse that the work went on past - a healer, the model provider, a commit - each once, its whole on hover. */
function FailureMarks({ failures }: { failures: Failure[] }) {
  if (failures.length === 0) return null;
  return (
    <div className="failure-marks">
      {failures.map((failure) => (
        <span key={failure.mark} className="failure-mark" title={failure.text}>
          <Icon name="warn" size={12} /> {failure.mark}
        </span>
      ))}
    </div>
  );
}

/** How a run was started, as the ledger's `run.started` names it. */
const MODES: Record<string, string> = { host: "in the app", chat: "in the terminal", regenerate: "turri regenerate, headless" };

/** When a run started: today's and yesterday's by their time, older ones by their date too. */
function when(ts: string | null): string {
  if (ts === null) return "a run";
  const at = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const ago = Math.round((day(new Date()) - day(at)) / 86_400_000);
  if (ago === 0) return `today, ${time}`;
  if (ago === 1) return `yesterday, ${time}`;
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}, ${time}`;
}

function runCost(run: PastRun): string {
  const spent = run.pulses.reduce((sum, pulse) => sum + (pulse.usage?.cost ?? 0), 0);
  return spent > 0 ? `$${spent.toFixed(2)}` : "";
}

/** How an earlier pulse ended: its status, whether it landed, who stopped it - or that its run stopped under it. */
function outcome(pulse: PastPulse): string {
  if (pulse.status === "unended") return "never ended - its session stopped while it ran";
  if (pulse.status === "unstarted") return "never started - its session stopped first";
  const by = pulse.status === "stopped" && pulse.stoppedBy !== null ? ` by ${pulse.stoppedBy === "turri" ? "turri" : "you"}` : "";
  const landed = pulse.landed === true ? ", landed" : pulse.landed === false ? ", did not land" : "";
  return `${pulse.status}${by}${landed}`;
}

/** A pulse of an earlier session: read only - how it ended, how long, what it cost - and opened into the ledger's facts. */
function PastPulseCard({ pulse, open, onOpen }: { pulse: PastPulse; open: boolean; onOpen: () => void }) {
  const kind = pulse.kind === "conformance" ? "conformance" : "regenerate";
  const copyable: Copyable = { id: pulse.id, summary: pulse.title ?? pulse.summary, module: pulse.module, pulse: pulse.pulse, kind: pulse.kind };
  const icon =
    pulse.status === "succeeded" ? (
      <Icon name={kind === "conformance" ? "checks" : "check"} />
    ) : pulse.status === "failed" ? (
      <Icon name="x" />
    ) : pulse.status === "stopped" ? (
      <Icon name="stop" />
    ) : (
      <Icon name="clock" />
    );
  return (
    <div className={`job past ${kind} ${pulse.status} ${open ? "open" : ""}`} data-id={pulse.id} onClick={() => opens() && onOpen()} onContextMenu={(event) => void copyMenu(event, copyable)}>
      <div className="job-head">
        <span className={`job-icon ${pulse.status}`}>{icon}</span>
        <div className="job-title">
          <strong title={copyable.summary}>{short(copyable.summary)}</strong>
          <span className="muted">
            {pulse.module ?? ""}
            {pulse.pulse !== null ? ` · pulse ${pulse.pulse}` : ""} <span className="kind-tag">{pulse.kind}</span>
          </span>
        </div>
        <div className="job-meta">
          <span>{pulse.ms !== null ? elapsed(0, pulse.ms) : ""}</span>
          {cost(pulse.usage ?? undefined) && <span className="muted">{cost(pulse.usage ?? undefined)}</span>}
        </div>
        <CopyButton pulse={copyable} />
      </div>
      <div className={`past-outcome ${pulse.status}`}>{outcome(pulse)}</div>
      <FailureMarks failures={pulse.failures} />
    </div>
  );
}

/** An earlier pulse, opened: what the ledger says of it - as `turri ledger <pulse>` prints it - and its log, to open. */
function PastPulseDetail({ pulse, onClose }: { pulse: PastPulse; onClose: () => void }) {
  const [detail, setDetail] = useState<{ lines: string[]; log: string | null } | { error: string } | null>(null);
  useEffect(() => {
    let alive = true;
    window.turri.call<{ lines: string[]; log: string | null }>("pastPulseDetail", { id: pulse.id, run: pulse.run }).then(
      (next) => alive && setDetail(next),
      (error: Error) => alive && setDetail({ error: error.message }),
    );
    return () => void (alive = false);
  }, [pulse.id, pulse.run]);
  // Its first line names it, as the card does; the log is a button, not a path to copy.
  const lines = detail !== null && "lines" in detail ? detail.lines.slice(1).filter((line) => !/^\s*log: /.test(line)) : [];
  return (
    <aside className="transcript">
      <div className="pane-header transcript-head">
        <span className="past-detail-title">
          {pulse.title ?? pulse.summary} <span className="muted">· from the ledger</span>
        </span>
        <span className="pane-header-right">
          {detail !== null && "log" in detail && detail.log !== null && (
            <button className="link" title={detail.log} onClick={() => void window.turri.openPath(detail.log!)}>
              <Icon name="file" size={14} /> open its log
            </button>
          )}
          <button className="icon-button" onClick={onClose} aria-label="close">
            <Icon name="x" />
          </button>
        </span>
      </div>
      <div className="transcript-body">
        {detail === null && <p className="muted pad">reading the ledger…</p>}
        {detail !== null && "error" in detail && <p className="muted pad">{detail.error}</p>}
        <ul className="ledger-lines">
          {lines.map((line, index) => (
            <li key={index} className={`${/^\s{4}/.test(line) ? "sub" : ""} ${/FAILED/.test(line) ? "failed" : ""}`}>
              {line.trim()}
            </li>
          ))}
        </ul>
      </div>
    </aside>
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
              {name === "spec" ? "intent" : name}
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
      return <div className="t-stage">{withPlain(turriSays(entry.text))}</div>;
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
