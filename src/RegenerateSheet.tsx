import { useState } from "react";
import type { Spec } from "./types.ts";
import { Icon, withPlain } from "./ui.tsx";

/** How to regenerate a module: each one of /regenerate's ways, said as turri takes it. */
export type Regeneration =
  | { how: "continue"; left: string[]; guidance: string }
  | { how: "changed"; guidance: string }
  | { how: "again"; frids: string[]; guidance: string }
  | { how: "scratch"; chain: boolean; guidance: string };

type How = "continue" | "changed" | "again" | "scratch" | "chain";

/**
 * Regenerate, chosen how: on where a module partly built stopped - its functional specs not built yet, and the first
 * choice while there are any - what changed in the spec (the button's own), chosen functional specs again though they did
 * not change, the whole module from scratch, or it and every module it requires from scratch - and, for any of them,
 * how to cut the work, in the person's words. It says what the person would type: from scratch, turri asks in the chat
 * before it deletes anything. A module with nothing built has one way of its own - all of it, each functional spec built
 * on the ones before it, so none alone and nothing to start over - and, on a chain, its chain from scratch.
 */
export function RegenerateSheet({ spec, initial, onClose, onRegenerate }: { spec: Spec; initial?: string[]; onClose: () => void; onRegenerate: (regeneration: Regeneration) => void }) {
  // Some of its functional specs built and some not - a regeneration stopped, or halted, part of the way: carry on.
  const left = spec.functionalSpecs.filter((entry) => !entry.built).map((entry) => entry.frid);
  const partly = left.length > 0 && left.length < spec.functionalSpecs.length;
  const none = !spec.functionalSpecs.some((entry) => entry.built);
  const [how, setHow] = useState<How>(initial?.length && !none ? "again" : partly ? "continue" : "changed");
  const [frids, setFrids] = useState<Set<string>>(new Set(initial ?? []));
  const [guidance, setGuidance] = useState("");
  const chained = spec.requires.length > 0;
  // Only what is built is regenerated again: what is not is built by continuing, or by what changed.
  const builtSpecs = spec.functionalSpecs.filter((entry) => entry.built);

  const toggle = (frid: string) =>
    setFrids((now) => {
      const next = new Set(now);
      if (next.has(frid)) next.delete(frid);
      else next.add(frid);
      return next;
    });

  const ways: Array<{ id: How; title: string; detail: string }> = none
    ? [
        {
          id: "changed",
          title: `all of ${spec.module}`,
          detail: `nothing of it is built yet: its ${spec.functionalSpecs.length === 1 ? "functional spec" : `${spec.functionalSpecs.length} functional specs`} regenerated from the ***plain, in pulses - each built on the ones before it.`,
        },
        ...(chained
          ? [{ id: "chain" as const, title: `${spec.module}, and its whole chain from scratch`, detail: `the modules it requires - ${spec.requires.join(", ")} - deleted and built again from the bottom first, then ${spec.module} on them.` }]
          : []),
      ]
    : [
    ...(partly
      ? [
          {
            id: "continue" as const,
            title: "continue where it stopped",
            detail: `${spec.functionalSpecs.length - left.length} of ${spec.functionalSpecs.length} functional specs are built: the ${left.length === 1 ? "one" : left.length} left - ${left.join(", ")} - built now, on top of what is built.`,
          },
        ]
      : []),
    {
      id: "changed",
      title: "what changed",
      detail: spec.drifted === false ? "the code is built from the ***plain as it is now: there is nothing to bring up to it." : "the code brought up to the ***plain as it is now - only what changed is built.",
    },
    { id: "again", title: "chosen functional specs again", detail: "built ones, built again though they did not change - the code for them rewritten from the spec." },
    { id: "scratch", title: `all of ${spec.module} from scratch`, detail: "its code and conformance tests deleted - committed first, so its history keeps them - and every functional spec built again." },
    ...(chained
      ? [{ id: "chain" as const, title: `${spec.module} and its whole chain from scratch`, detail: `the same for every module it requires too - ${spec.requires.join(", ")} - built again from the bottom.` }]
      : []),
      ];

  const ordered = builtSpecs.filter((entry) => frids.has(entry.frid)).map((entry) => entry.frid);
  const ready = how !== "again" || ordered.length > 0;
  const go = () => {
    if (!ready) return;
    const said = guidance.trim();
    onRegenerate(how === "continue" ? { how, left, guidance: said } : how === "changed" ? { how, guidance: said } : how === "again" ? { how, frids: ordered, guidance: said } : { how: "scratch", chain: how === "chain", guidance: said });
  };
  const deletes = how === "scratch" || how === "chain";

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet regenerate" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.key === "Escape" && onClose()}>
        <h2>regenerate {spec.module}</h2>
        <div className="options">
          {ways.map((way) => (
            <button key={way.id} className={`option ${how === way.id ? "on" : ""}`} onClick={() => setHow(way.id)} aria-pressed={how === way.id}>
              <strong>{way.title}</strong>
              <span className="option-detail">{withPlain(way.detail)}</span>
            </button>
          ))}
        </div>

        {how === "again" && (
          <div className="regenerate-specs">
            <div className="regenerate-specs-head">
              <span className="muted">
                {ordered.length} of {builtSpecs.length} built chosen
              </span>
              <button className="link" onClick={() => setFrids(new Set(ordered.length === builtSpecs.length ? [] : builtSpecs.map((entry) => entry.frid)))}>
                {ordered.length === builtSpecs.length ? "none" : "all"}
              </button>
            </div>
            <div className="options">
              {builtSpecs.map((entry) => (
                <button key={entry.frid} role="checkbox" aria-checked={frids.has(entry.frid)} className={`option check ${frids.has(entry.frid) ? "on" : ""}`} onClick={() => toggle(entry.frid)}>
                  <span className="checkbox">{frids.has(entry.frid) && <Icon name="check" size={12} />}</span>
                  <span className="regenerate-spec">
                    <span className="regenerate-frid">{entry.frid}</span>
                    <span className="regenerate-text">{entry.text.split("\n")[0]}</span>
                  </span>
                  <span className="muted small">{entry.conformed ? "tested" : "built"}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="regenerate-guidance">
          <span>how to cut the work <span className="muted">- optional</span></span>
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
            cancel
          </button>
          <button className="button primary" onClick={go} disabled={!ready} autoFocus>
            <Icon name="play" /> regenerate
          </button>
        </div>
      </div>
    </div>
  );
}
