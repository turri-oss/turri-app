import { useCallback, useEffect, useState } from "react";
import type { Check } from "../electron/preload.ts";
import { HelpButton, problems } from "./DoctorSheet.tsx";
import { helpFor } from "./installers.ts";
import { Icon, Spinner } from "./ui.tsx";

/**
 * From just installed to a first project running, in three steps, each ticked once it is done: this machine has what
 * turri needs - git, bash, the OS sandbox, as turri doctor checks them, with where to get what is missing - turri can
 * reach a model, signed in to a provider, and the first project is started. On the welcome screen until a project has
 * been opened; Help > Getting Started shows it again.
 */
export function GettingStarted({
  checks,
  onSignIn,
  onNew,
  onDoctor,
  onCheckAgain,
}: {
  /** turri doctor's checks of this machine: undefined while they run, null from a turri without them. */
  checks: Check[] | null | undefined;
  onSignIn: () => void;
  onNew?: () => void;
  onDoctor: () => void;
  onCheckAgain: () => void;
}) {
  // Back in the window - from an installer, or the browser - the machine is checked again.
  useEffect(() => {
    const back = () => onCheckAgain();
    window.addEventListener("focus", back);
    return () => window.removeEventListener("focus", back);
  }, [onCheckAgain]);

  const provider = checks?.find((check) => check.name === "Model provider");
  const machine = problems(checks ?? null).filter((check) => check !== provider);
  const machineReady = checks !== undefined && checks !== null && machine.length === 0;
  const signedIn = provider?.level === "ok";

  return (
    <ol className="getting-started" aria-label="getting started">
      <li className={machineReady ? "done" : ""}>
        <span className="step-mark">{checks === undefined ? <Spinner /> : machineReady ? <Icon name="check" size={14} /> : "1"}</span>
        <div>
          <strong>this machine has what turri needs</strong>
          {checks === undefined && <p className="muted small">checking git, bash and the OS sandbox…</p>}
          {checks === null && <p className="muted small">this turri cannot check the machine.</p>}
          {machineReady && <p className="muted small">git, bash and the OS sandbox are here.</p>}
          {machine.map((check) => (
            <div key={check.name} className="step-need">
              <p className="small">
                <strong>{check.name}</strong> <span className="muted">{check.detail}</span>
              </p>
              <div className="check-help">
                {helpFor(check).map((help) => (
                  <HelpButton key={help.label} help={help} />
                ))}
                <button className="link small" onClick={onDoctor}>
                  more
                </button>
              </div>
            </div>
          ))}
        </div>
      </li>
      <li className={signedIn ? "done" : ""}>
        <span className="step-mark">{signedIn ? <Icon name="check" size={14} /> : "2"}</span>
        <div>
          <strong>turri can reach a model</strong>
          {signedIn ? (
            <p className="muted small">{provider!.detail}</p>
          ) : (
            <>
              <p className="muted small">sign in to a model provider - a subscription such as Claude Pro or ChatGPT Plus, or an API key. turri sends it your ***plain and code as it works.</p>
              <button className="button small" onClick={onSignIn}>
                <Icon name="key" size={13} /> sign in to your models…
              </button>
            </>
          )}
        </div>
      </li>
      <li>
        <span className="step-mark">3</span>
        <div>
          <strong>start your first project</strong>
          <p className="muted small">name its folder and choose its models. then tell turri what you want to build: it writes the ***plain with you in the chat, builds the code from it, and you try it in the preview.</p>
          {onNew && (
            <button className="button small primary" onClick={onNew}>
              <Icon name="plus" size={13} /> start a new project…
            </button>
          )}
        </div>
      </li>
    </ol>
  );
}

/** Help > Getting Started, with a project open: the same steps, in a sheet, the machine checked as it opens. */
export function GettingStartedSheet({ onSignIn, onNew, onDoctor, onClose }: { onSignIn: () => void; onNew: () => void; onDoctor: () => void; onClose: () => void }) {
  const [checks, setChecks] = useState<Check[] | null | undefined>(undefined);
  const check = useCallback(() => void window.turri.doctor().then(setChecks).catch(() => setChecks(null)), []);
  useEffect(check, []);
  useEffect(() => window.turri.on("engine:auth:done", ({ ok }: { ok: boolean }) => ok && check()), []);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet getting-started-sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="getting started">
        <h2>getting started</h2>
        <GettingStarted checks={checks} onSignIn={onSignIn} onNew={onNew} onDoctor={onDoctor} onCheckAgain={check} />
        <div className="sheet-actions">
          <button className="button primary" onClick={onClose}>
            close
          </button>
        </div>
      </div>
    </div>
  );
}
