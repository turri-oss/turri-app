import { useEffect, useState } from "react";
import type { Check } from "../electron/preload.ts";
import { Icon, Spinner } from "./ui.tsx";

const MARK: Record<Check["level"], string> = { ok: "✓", missing: "✗", limited: "!", info: "·" };
/** What wants doing first, first. */
const ORDER: Record<Check["level"], number> = { missing: 0, limited: 1, info: 2, ok: 3 };

/** The checks that want something done: what is missing, and what works only in part. */
export const problems = (checks: Check[] | null) => (checks ?? []).filter((check) => check.level === "missing" || check.level === "limited");

/** How many things want seeing to, said in a line: "2 things to see to on this machine". */
export const toSeeTo = (wanting: Check[]) => `${wanting.length} thing${wanting.length === 1 ? "" : "s"} to see to on this machine`;

/**
 * turri doctor's checks, run by the window's engine on the PATH it runs turri with - of the project open, or of the one
 * named (`dir`) - and run again on asking. The models are asked from the start only when `askModels` says so, as each
 * answer costs money.
 */
export function useDoctor(askModels: boolean, dir?: string) {
  const [checks, setChecks] = useState<Check[] | null | undefined>(undefined);
  const [models, setModels] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = async (withModels: boolean) => {
    setChecking(true);
    setError(null);
    try {
      setChecks(await window.turri.doctor(withModels, dir));
      setModels(withModels);
    } catch (failure) {
      setError(String((failure as Error).message ?? failure).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => void run(askModels), []);
  return { checks, models, checking, error, run, askModels };
}

/** What the checks found: a line for what wants doing, then each check - what wants doing first - with what to do about it. */
export function DoctorChecks({ doctor }: { doctor: ReturnType<typeof useDoctor> }) {
  const { checks, error, askModels } = doctor;
  const wanting = problems(checks ?? null);
  const sorted = [...(checks ?? [])].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  return (
    <>
      {checks === undefined && !error && (
        <p className="muted">
          <Spinner /> {askModels ? "checking, and asking each model for a word…" : "checking…"}
        </p>
      )}
      {checks === null && <p className="muted">this turri cannot check the machine: checking needs a turri newer than 0.1.9.</p>}
      {error && <p className="error-text">{error}</p>}
      {checks && (
        <>
          <p className={`doctor-summary ${wanting.length > 0 ? "wanting" : ""}`}>
            {wanting.length === 0 ? "everything turri needs is here." : `${toSeeTo(wanting)} - what to do is under ${wanting.length === 1 ? "it" : "each"}.`}
          </p>
          <ul className="checks">
            {sorted.map((check, index) => (
              <li key={index} className={check.level}>
                <span className="check-mark">{MARK[check.level]}</span>
                <div>
                  <strong>{check.name}</strong> <span className="check-detail">{check.detail}</span>
                  {check.more?.map((line, at) => (
                    <div key={at} className="muted small">
                      {line}
                    </div>
                  ))}
                  {check.fix && <div className="check-fix">{check.fix}</div>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/**
 * Whether this machine - and the project open, if one is - is ready for turri: `turri doctor`'s checks, each with what
 * to do about it. The models are asked only on a click, as each answer costs money - or from the start (`askModels`)
 * when a project has just been started on the ones chosen.
 */
export function DoctorSheet({ project, askModels = false, onClose }: { project: string | null; askModels?: boolean; onClose: () => void }) {
  const doctor = useDoctor(askModels);
  const { checks, models, checking, run } = doctor;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet doctor" onClick={(event) => event.stopPropagation()}>
        <h2>is this machine ready for turri?</h2>
        <p className="muted small">
          {project === null ? "this machine" : `this machine, and ${project}`} - as <code>turri doctor</code> checks it, on the PATH turri runs with here.
        </p>
        <DoctorChecks doctor={doctor} />
        <div className="sheet-actions">
          {project !== null && checks && !models && (
            <button className="button" onClick={() => void run(true)} disabled={checking} title="sends each model config.turri.yaml names a word, to see that it answers - which costs a little">
              ask the models too
            </button>
          )}
          <button className="button" onClick={() => void run(models)} disabled={checking}>
            {checking ? <Spinner /> : <Icon name="reload" />} check again
          </button>
          <button className="button primary" onClick={onClose}>
            close
          </button>
        </div>
      </div>
    </div>
  );
}
