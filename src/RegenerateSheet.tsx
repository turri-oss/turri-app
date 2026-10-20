import { useState } from "react";
import type { Spec } from "./types.ts";
import { Icon } from "./ui.tsx";

/** How to regenerate a module: each one of /regenerate's ways, said as turri takes it. */
export type Regeneration =
  | { how: "changed"; guidance: string }
  | { how: "again"; frids: string[]; guidance: string }
  | { how: "scratch"; chain: boolean; guidance: string };

type How = "changed" | "again" | "scratch" | "chain";

/**
 * Regenerate, chosen how: what changed in the spec (the button's own), chosen functional specs again though they did
 * not change, the whole module from scratch, or it and every module it requires from scratch - and, for any of them,
 * how to cut the work, in the person's words. It says what the person would type: from scratch, turri asks in the chat
 * before it deletes anything.
 */
export function RegenerateSheet({ spec, initial, onClose, onRegenerate }: { spec: Spec; initial?: string[]; onClose: () => void; onRegenerate: (regeneration: Regeneration) => void }) {
  const [how, setHow] = useState<How>(initial?.length ? "again" : "changed");
  const [frids, setFrids] = useState<Set<string>>(new Set(initial ?? []));
  const [guidance, setGuidance] = useState("");
  const chained = spec.requires.length > 0;

  const toggle = (frid: string) =>
    setFrids((now) => {
      const next = new Set(now);
      if (next.has(frid)) next.delete(frid);
      else next.add(frid);
      return next;
    });

  const ways: Array<{ id: How; title: string; detail: string }> = [
    {
      id: "changed",
      title: "What changed",
      detail: spec.drifted === false ? "The code is built from the spec as it is now: there is nothing to bring up to it." : "The code brought up to the spec as it is now - only what changed is built.",
    },
    { id: "again", title: "Chosen functional specs again", detail: "Built again though they did not change - the code for them rewritten from the spec." },
    { id: "scratch", title: `All of ${spec.module} from scratch`, detail: "Its code and conformance tests deleted - committed first, so its history keeps them - and every functional spec built again." },
    ...(chained
      ? [{ id: "chain" as const, title: `${spec.module} and its whole chain from scratch`, detail: `The same for every module it requires too - ${spec.requires.join(", ")} - built again from the bottom.` }]
      : []),
  ];

  const ordered = spec.functionalSpecs.filter((entry) => frids.has(entry.frid)).map((entry) => entry.frid);
  const ready = how !== "again" || ordered.length > 0;
  const go = () => {
    if (!ready) return;
    const said = guidance.trim();
    onRegenerate(how === "changed" ? { how, guidance: said } : how === "again" ? { how, frids: ordered, guidance: said } : { how: "scratch", chain: how === "chain", guidance: said });
  };
  const deletes = how === "scratch" || how === "chain";

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet regenerate" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.key === "Escape" && onClose()}>
        <h2>Regenerate {spec.module}</h2>
        <div className="options">
          {ways.map((way) => (
            <button key={way.id} className={`option ${how === way.id ? "on" : ""}`} onClick={() => setHow(way.id)} aria-pressed={how === way.id}>
              <strong>{way.title}</strong>
              <span className="option-detail">{way.detail}</span>
            </button>
          ))}
        </div>

        {how === "again" && (
          <div className="regenerate-specs">
            <div className="regenerate-specs-head">
              <span className="muted">
                {ordered.length} of {spec.functionalSpecs.length} chosen
              </span>
              <button className="link" onClick={() => setFrids(new Set(ordered.length === spec.functionalSpecs.length ? [] : spec.functionalSpecs.map((entry) => entry.frid)))}>
                {ordered.length === spec.functionalSpecs.length ? "None" : "All"}
              </button>
            </div>
            <div className="options">
              {spec.functionalSpecs.map((entry) => (
                <button key={entry.frid} role="checkbox" aria-checked={frids.has(entry.frid)} className={`option check ${frids.has(entry.frid) ? "on" : ""}`} onClick={() => toggle(entry.frid)}>
                  <span className="checkbox">{frids.has(entry.frid) && <Icon name="check" size={12} />}</span>
                  <span className="regenerate-spec">
                    <span className="regenerate-frid">{entry.frid}</span>
                    <span className="regenerate-text">{entry.text.split("\n")[0]}</span>
                  </span>
                  <span className="muted small">{entry.conformed ? "tested" : entry.built ? "built" : "to build"}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="regenerate-guidance">
          <span>How to cut the work <span className="muted">- optional</span></span>
          <textarea
            value={guidance}
            onChange={(event) => setGuidance(event.target.value)}
            placeholder="one functional spec per pulse, say - or the storage first, then the API"
            rows={2}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) go();
            }}
          />
        </label>

        <div className="sheet-actions">
          {deletes && <span className="muted small regenerate-warning">turri asks you in the chat before it deletes anything.</span>}
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" onClick={go} disabled={!ready} autoFocus>
            <Icon name="play" /> Regenerate
          </button>
        </div>
      </div>
    </div>
  );
}
