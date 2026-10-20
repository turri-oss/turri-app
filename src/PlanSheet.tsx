import { useState } from "react";
import type { ModuleStatus, Spec } from "./types.ts";
import { Icon } from "./ui.tsx";
import { turriSays } from "./PulseSpec.tsx";

export interface Plan {
  spec: Spec;
  statuses: ModuleStatus[];
  firsts: Array<{ module: string; title: string; reason: string; track: string; prompt: string | null }>;
}

/** What Regenerate would do, planned and not started: the pulses, and the first one's prompt - `turri glimpse`. */
export function PlanSheet({ plan, onClose, onRegenerate }: { plan: Plan; onClose: () => void; onRegenerate: () => void }) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const work = plan.statuses.filter((status) => status.planned.length > 0);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <h2>the plan for {plan.spec.module}</h2>
        {work.length === 0 ? (
          <p className="muted">nothing to regenerate: every codebase is built from the spec as it is.</p>
        ) : (
          work.map((status) => (
            <div key={status.module} className="module-plan">
              <div className="module-plan-head">
                <Icon name="layers" /> <strong>{status.module}</strong> <span className="muted">· {status.planned.length} pulse{status.planned.length === 1 ? "" : "s"}</span>
              </div>
              <ol className="planned">
                {status.planned.map((entry, index) => (
                  <li key={index}>
                    <span className="planned-index">{index + 1}</span>
                    <span>{entry.title}</span>
                    {entry.track === "conformance" && <span className="tag">conformance</span>}
                  </li>
                ))}
              </ol>
              {status.planNotes?.map((note, index) => (
                <p key={index} className="muted small">
                  {turriSays(note)}
                </p>
              ))}
            </div>
          ))
        )}
        {plan.firsts.map((first) => (
          <div key={first.module} className="first">
            <p>
              <strong>first:</strong> {first.title} <span className="muted">- {first.reason}</span>
            </p>
            {first.prompt && (
              <button className="link" onClick={() => setPrompt(prompt === null ? first.prompt : null)}>
                {prompt === null ? "show what the coding agent will be told" : "hide the prompt"}
              </button>
            )}
          </div>
        ))}
        {prompt && <pre className="prompt-preview">{prompt}</pre>}
        <div className="sheet-actions">
          <button className="button" onClick={onClose}>
            close
          </button>
          <button className="button primary" onClick={onRegenerate} disabled={work.length === 0}>
            <Icon name="play" /> regenerate
          </button>
        </div>
      </div>
    </div>
  );
}
