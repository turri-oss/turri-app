import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Job, Spec } from "./types.ts";
import { elapsed, Icon, PlainText, Spinner, useTick } from "./ui.tsx";

type Token = { text: string; role: string | null };

/**
 * The spec, two ways: as text, coloured by turri's own ***plain grammar, and as what it asks for - a card for each
 * functional spec, showing whether its code is built, and the one being built now.
 */
export function SpecView(props: {
  spec: Spec;
  running?: Job;
  onSaved: (spec: Spec) => void;
  onDirty: (dirty: boolean) => void;
  saveRef: MutableRefObject<(() => Promise<void>) | null>;
  onRegenerate: (frids?: string[]) => void;
  onConform: (frids?: string[]) => void;
  say: (text: string, tone?: "info" | "error") => void;
}) {
  const { spec, running } = props;
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [lines, setLines] = useState<Token[][]>([]);
  const [saving, setSaving] = useState(false);
  const overlay = useRef<HTMLPreElement>(null);

  useEffect(() => {
    void window.turri.call<{ text: string }>("readSpec", { file: spec.file }).then(({ text }) => {
      setText(text);
      setSaved(text);
    });
  }, [spec.file]);

  // Coloured as turri's grammar has it, a moment after typing stops.
  useEffect(() => {
    if (text === null) return;
    const timer = setTimeout(() => void window.turri.call<Token[][]>("highlightSpec", { text }).then(setLines), 80);
    return () => clearTimeout(timer);
  }, [text]);

  const dirty = text !== null && text !== saved;
  useEffect(() => props.onDirty(dirty), [dirty]);

  const save = async () => {
    if (text === null || !dirty) return;
    setSaving(true);
    try {
      const next = await window.turri.call<Spec>("writeSpec", { file: spec.file, text });
      setSaved(text);
      props.onSaved(next);
      if (!next.ok) props.say(`Saved, but the spec does not parse: ${next.error}`, "error");
    } finally {
      setSaving(false);
    }
  };
  props.saveRef.current = save;

  const building = running?.building?.label;
  const cardMenu = async (frid: string) => {
    const chosen = await window.turri.popup([
      { id: "again", label: `Regenerate functional spec ${frid} again` },
      { id: "conform", label: `Write conformance tests for ${frid}` },
      { type: "separator" },
      { id: "copy", label: "Copy text" },
    ]);
    if (chosen === "again") props.onRegenerate([frid]);
    else if (chosen === "conform") props.onConform([frid]);
    else if (chosen === "copy") void navigator.clipboard.writeText(spec.functionalSpecs.find((entry) => entry.frid === frid)?.text ?? "");
  };

  const built = spec.functionalSpecs.filter((entry) => entry.built).length;

  return (
    <div className="spec-view">
      <div className="editor-pane">
        <div className="pane-header">
          <span>
            <Icon name="doc" /> {spec.rel}
          </span>
          <span className="pane-header-right">
            {dirty ? (
              <button className="button small" onClick={() => void save()} disabled={saving}>
                {saving ? <Spinner /> : null} Save <kbd>⌘S</kbd>
              </button>
            ) : (
              <span className="muted">Saved</span>
            )}
          </span>
        </div>
        {text === null ? (
          <div className="center">
            <Spinner />
          </div>
        ) : (
          <div className="editor">
            <pre ref={overlay} className="editor-colours" aria-hidden>
              {lines.map((tokens, index) => (
                <div key={index}>
                  {tokens.length === 0 ? "​" : tokens.map((token, at) => (token.role ? <span key={at} className={`plain-${token.role}`}>{token.text}</span> : token.text))}
                </div>
              ))}
            </pre>
            <textarea
              spellCheck={false}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onScroll={(event) => {
                if (overlay.current) {
                  overlay.current.scrollTop = event.currentTarget.scrollTop;
                  overlay.current.scrollLeft = event.currentTarget.scrollLeft;
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "s" && event.metaKey) {
                  event.preventDefault();
                  void save();
                }
                if (event.key === "Tab") {
                  event.preventDefault();
                  const area = event.currentTarget;
                  const { selectionStart, selectionEnd } = area;
                  setText(area.value.slice(0, selectionStart) + "  " + area.value.slice(selectionEnd));
                  requestAnimationFrame(() => area.setSelectionRange(selectionStart + 2, selectionStart + 2));
                }
              }}
            />
          </div>
        )}
      </div>

      <div className="cards-pane">
        <div className="pane-header">
          <span>Functional specs</span>
          <span className="pane-header-right muted">
            {built} of {spec.functionalSpecs.length} built
          </span>
        </div>
        {!spec.ok ? (
          <div className="parse-error">
            <Icon name="warn" />
            <div>
              <strong>The spec does not parse</strong>
              <p>{spec.error}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="progress">
              <div style={{ width: `${spec.functionalSpecs.length ? (built / spec.functionalSpecs.length) * 100 : 0}%` }} />
            </div>
            {running && <RunningBanner job={running} />}
            <ol className="cards">
              {spec.functionalSpecs.map((entry) => {
                const now = building !== undefined && new RegExp(`functionality ${entry.frid.replace(".", "\\.")}\\b`).test(building);
                return (
                  <li
                    key={entry.frid}
                    className={`card ${entry.built ? "built" : ""} ${now ? "now" : ""}`}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      void cardMenu(entry.frid);
                    }}
                  >
                    <div className="card-head">
                      <span className="frid">{entry.frid}</span>
                      <span className="card-state">
                        {now ? (
                          <>
                            <Spinner /> building
                          </>
                        ) : entry.built ? (
                          <>
                            <Icon name="check" /> built
                          </>
                        ) : (
                          "to build"
                        )}
                      </span>
                      <button className="card-more" onClick={() => void cardMenu(entry.frid)} aria-label="More">
                        ···
                      </button>
                    </div>
                    <div className="card-body">
                      {entry.text.split("\n").map((line, index) =>
                        index === 0 ? (
                          <p key={index}>
                            <PlainText text={line} />
                          </p>
                        ) : (
                          <p key={index} className="sub">
                            <PlainText text={line.replace(/^\s*- /, "")} />
                          </p>
                        ),
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {spec.functionalSpecs.length === 0 && <p className="muted pad">This module has no functional specs yet. Add them under ***functional specs***.</p>}
          </>
        )}
      </div>
    </div>
  );
}

function RunningBanner({ job }: { job: Job }) {
  useTick();
  return (
    <div className="running-banner">
      <Spinner />
      <div>
        <strong>{job.title ?? job.summary}</strong>
        <span>
          {job.now?.label ?? job.stage ?? "starting"} · {elapsed(job.startedAt)}
        </span>
      </div>
    </div>
  );
}
