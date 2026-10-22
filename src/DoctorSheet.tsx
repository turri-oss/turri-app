import { useEffect, useState } from "react";
import type { Check } from "../electron/preload.ts";
import { AuthSheet } from "./AuthSheet.tsx";
import { fixFor, helpFor, type Help } from "./installers.ts";
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
 * answer costs money. Checks already run (`initial`) are shown as they are, not run again.
 */
export function useDoctor(askModels: boolean, dir?: string, initial?: Check[]) {
  const [checks, setChecks] = useState<Check[] | null | undefined>(initial);
  const [models, setModels] = useState(initial !== undefined && askModels);
  const [checking, setChecking] = useState(initial === undefined);
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
  useEffect(() => {
    if (initial === undefined) void run(askModels);
  }, []);
  return { checks, models, checking, error, run, askModels };
}

/** A check's way to what it wants: an installer's page, in the browser, Apple's developer tools, or signing in. */
export function HelpButton({ help, onSignIn }: { help: Help; onSignIn?: () => void }) {
  if ("url" in help)
    return (
      <a className="button small" href={help.url} target="_blank" rel="noreferrer" title={help.url}>
        <Icon name="globe" size={13} /> {help.label}
      </a>
    );
  if (help.action === "sign-in")
    return onSignIn ? (
      <button className="button small" onClick={onSignIn}>
        <Icon name="key" size={13} /> {help.label}
      </button>
    ) : null;
  return (
    <button className="button small" onClick={() => void window.turri.installDeveloperTools()} title="xcode-select --install: Apple's installer opens, and installs git, bash's tools and a C compiler">
      <Icon name="plus" size={13} /> {help.label}
    </button>
  );
}

/**
 * What the checks found: a line for what wants doing, then each check - what wants doing first - with what to do about
 * it, and a way to it: an installer's page, or signing in (`onSignIn`).
 */
export function DoctorChecks({ doctor, onSignIn }: { doctor: ReturnType<typeof useDoctor>; onSignIn?: () => void }) {
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
                  {fixFor(check) && check.level !== "ok" && <div className="check-fix">{fixFor(check)}</div>}
                  {helpFor(check).length > 0 && (
                    <div className="check-help">
                      {helpFor(check).map((help) => (
                        <HelpButton key={help.label} help={help} onSignIn={onSignIn} />
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {wanting.some((check) => helpFor(check).some((help) => !("action" in help && help.action === "sign-in"))) && (
            <p className="muted small">installed something? check again. still missing, quit turri and start it again: it reads your shell's PATH as it starts.</p>
          )}
        </>
      )}
    </>
  );
}

/**
 * Whether this machine - and the project open, if one is - is ready for turri: `turri doctor`'s checks, each with what
 * to do about it. The models are asked only on a click, as each answer costs money - or from the start (`askModels`)
 * when a project has just been started on the ones chosen, which opens the sheet only on what wants seeing to, its
 * checks already run (`initial`).
 */
export function DoctorSheet({ project, askModels = false, initial, onClose }: { project: string | null; askModels?: boolean; initial?: Check[]; onClose: () => void }) {
  const doctor = useDoctor(askModels, undefined, initial);
  const { checks, models, checking, run } = doctor;
  // Signing in to a model provider, over the checks - which are run again once it closes, the models not asked again.
  const [signingIn, setSigningIn] = useState(false);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet doctor" onClick={(event) => event.stopPropagation()}>
        <h2>is this machine ready for turri?</h2>
        <p className="muted small">
          {project === null ? "this machine" : `this machine, and ${project}`} - as <code>turri doctor</code> checks it, on the PATH turri runs with here.
        </p>
        <DoctorChecks doctor={doctor} onSignIn={() => setSigningIn(true)} />
        <div className="sheet-actions">
          <button className="button sheet-actions-start" onClick={() => setSigningIn(true)} title="sign in to the providers turri's models come from - a subscription, or an API key">
            <Icon name="key" /> sign in to your models…
          </button>
          {project !== null && checks && !models && (
            <button className="button" onClick={() => void run(true)} disabled={checking} title="sends each model config.turri.yaml names a word, to see that it answers - which costs a little">
              ask the models too
            </button>
          )}
          <button className="button" onClick={() => void run(models)} disabled={checking}>
            {checking ? <Spinner /> : <Icon name="reload" />} check again
          </button>
          <button className="button primary" onClick={onClose}>
            okay
          </button>
        </div>
      </div>
      {signingIn && <AuthSheet onClose={() => (setSigningIn(false), void run(false))} />}
    </div>
  );
}
