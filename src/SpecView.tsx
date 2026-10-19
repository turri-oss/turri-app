import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Job, Spec } from "./types.ts";
import { Icon, Spinner } from "./ui.tsx";

type Token = { text: string; role: string | null };
type State = "built" | "now" | "todo";
/** A line of a functional spec: its id, whether it is the spec's first, and which line that is. */
type SpecLine = { frid: string; first: boolean; line: number };

/**
 * The lines of each functional spec in the text, by its id: turri numbers them 1 to n, one for each top-level bullet
 * under ***functional specs***, and a spec runs on over the indented lines below its bullet.
 */
function functionalSpecLines(text: string): Map<number, SpecLine> {
  const found = new Map<number, SpecLine>();
  let inSection = false;
  let count = 0;
  let current: string | null = null;
  let start = 0;
  text.split("\n").forEach((line, index) => {
    const heading = /^\*\*\*(.+)\*\*\*\s*$/.exec(line);
    if (heading) {
      inSection = heading[1]!.trim().toLowerCase() === "functional specs";
      current = null;
    } else if (!inSection || line.trim() === "") {
      return;
    } else if (/^-(\s|$)/.test(line)) {
      current = String(++count);
      start = index;
      found.set(index, { frid: current, first: true, line: index });
    } else if (current !== null && /^\s/.test(line)) {
      found.set(index, { frid: current, first: false, line: start });
    } else {
      current = null;
    }
  });
  return found;
}

const STATE_LABEL: Record<State, string> = { built: "built", now: "building now", todo: "to build" };

/**
 * The lines of this file the running work renders now, from 0: a code pulse's are what its spec change adds here - its
 * diff's added lines, placed in the files - and a conformance run's the functional spec it builds. A placed line whose
 * text is not what the file has there now is left out: the file moved on.
 */
function renderingLines(job: Job | undefined, spec: Spec, text: string, specLines: Map<number, SpecLine>): Set<number> {
  const found = new Set<number>();
  if (job === undefined) return found;
  const lines = text.split("\n");
  if (job.diff !== undefined && job.diffWhere !== undefined) {
    const diffLines = job.diff.split("\n");
    for (const [index, where] of Object.entries(job.diffWhere)) {
      const line = diffLines[Number(index)];
      if (where.file !== spec.rel || line === undefined || !line.startsWith("+")) continue;
      if (lines[where.line - 1]?.trimEnd() === line.slice(1).trimEnd()) found.add(where.line - 1);
    }
  }
  const building = /^(\S+) functionality (\d+) of/.exec(job.building?.label ?? "");
  if (building && building[1] === spec.module) for (const [index, mark] of specLines) if (mark.frid === building[2]) found.add(index);
  return found;
}

/**
 * The spec as text, coloured by turri's own ***plain grammar, with each functional spec's state in the gutter beside
 * it: built, being built now, or still to build. The text is said once.
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
  // The file as it is on disk now, when it changed there under edits not yet saved: for the person to take or leave.
  const [onDisk, setOnDisk] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const now = useRef({ text, saved });
  now.current = { text, saved };

  useEffect(() => {
    void window.turri.call<{ text: string }>("readSpec", { file: spec.file }).then(({ text }) => {
      setText(text);
      setSaved(text);
    });
  }, [spec.file]);

  // Changed on disk - turri edited it from the chat, say: taken at once, unless there are edits it would undo.
  useEffect(
    () =>
      window.turri.on("engine:spec", ({ file, text: disk }: { file: string; text: string }) => {
        if (file !== spec.file || disk === now.current.saved) return;
        if (now.current.text === now.current.saved || now.current.text === disk) {
          setText(disk);
          setSaved(disk);
          setOnDisk(null);
        } else setOnDisk(disk);
      }),
    [spec.file],
  );

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
      setOnDisk(null);
      props.onSaved(next);
      if (!next.ok) props.say(`Saved, but the spec does not parse: ${next.error}`, "error");
    } finally {
      setSaving(false);
    }
  };
  props.saveRef.current = save;

  // The functional spec a conformance run builds now, as "<module> functionality <n>".
  const building = running?.building?.label.replace(/ of \d+$/, "");
  // Saved, a functional spec's state is its number's. Edited since, numbers shift as specs are added or moved: a spec is
  // known by its text then, and one whose text is new is still to build.
  const entryFor = (frid: string, line: string) =>
    dirty ? spec.functionalSpecs.find((entry) => entry.text.split("\n")[0]!.trim() === line.replace(/^-\s*/, "").trim()) : spec.functionalSpecs.find((entry) => entry.frid === frid);
  const stateOf = (frid: string, line: string): State => {
    if (renderingFrids.has(frid)) return "now";
    const entry = entryFor(frid, line);
    if (entry === undefined) return "todo";
    if (building !== undefined && building === `${spec.module} functionality ${entry.frid}`) return "now";
    return entry.built ? "built" : "todo";
  };
  const markerMenu = async (frid: string) => {
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

  const total = spec.functionalSpecs.length;
  const built = spec.functionalSpecs.filter((entry) => entry.built).length;
  const specLines = spec.ok && text !== null ? functionalSpecLines(text) : new Map<number, SpecLine>();
  const rendering = text !== null ? renderingLines(running, spec, text, specLines) : new Set<number>();
  const firstRendering = rendering.size > 0 ? Math.min(...rendering) : undefined;
  // A functional spec any of whose lines the running work renders is being built now.
  const renderingFrids = new Set([...rendering].flatMap((index) => specLines.get(index)?.frid ?? []));

  const showLine = (index: number) => {
    const line = editorRef.current?.querySelector<HTMLElement>(`.editor-colours > div:nth-child(${index + 1})`);
    if (line && editorRef.current) editorRef.current.scrollTo({ top: Math.max(0, line.offsetTop - editorRef.current.clientHeight / 3), behavior: "smooth" });
  };
  // What a pulse renders is brought into view as it starts - unless the person is typing in the spec.
  useEffect(() => {
    if (firstRendering !== undefined && document.activeElement !== areaRef.current) showLine(firstRendering);
  }, [running?.id, firstRendering]);

  return (
    <div className="spec-view">
      <div className="editor-pane">
        <div className="pane-header">
          <span>
            <Icon name="doc" /> {spec.rel}
          </span>
          <span className="pane-header-right">
            {spec.ok && total > 0 && (
              <span className="muted">
                {built} of {total} built ·
              </span>
            )}
            {dirty ? (
              <button className="button small" onClick={() => void save()} disabled={saving}>
                {saving ? <Spinner /> : null} Save <kbd>⌘S</kbd>
              </button>
            ) : (
              <span className="muted">Saved</span>
            )}
          </span>
        </div>
        {spec.ok && total > 0 && (
          <div className="progress">
            <div style={{ width: `${(built / total) * 100}%` }} />
          </div>
        )}
        {!spec.ok && (
          <div className="parse-error">
            <Icon name="warn" />
            <div>
              <strong>The spec does not parse</strong>
              <p>{spec.error}</p>
            </div>
          </div>
        )}
        {onDisk !== null && (
          <div className="disk-banner">
            <Icon name="warn" />
            <span>{spec.rel} changed on disk while you were editing it.</span>
            <button
              className="button small"
              onClick={() => {
                setText(onDisk);
                setSaved(onDisk);
                setOnDisk(null);
              }}
            >
              Load the new version
            </button>
          </div>
        )}
        {text === null ? (
          <div className="center">
            <Spinner />
          </div>
        ) : (
          // One scrolling box holds both layers, so they are always the same width and wrap alike: the coloured text
          // in the flow, giving the height, and the textarea laid exactly over it. A line is drawn as typed at once,
          // and coloured once its colours, a moment behind, are for the same text. The gutter, left of both, is drawn
          // by the coloured lines, so each functional spec's mark stays beside its lines however they wrap.
          <div className="editor" ref={editorRef}>
            <div className="editor-sheet">
            <pre className="editor-colours" aria-hidden>
              {text.split("\n").map((line, index) => {
                const tokens = lines[index];
                const coloured = tokens !== undefined && tokens.map((token) => token.text).join("") === line;
                const mark = specLines.get(index);
                const state = mark && stateOf(mark.frid, text.split("\n")[mark.line]!);
                return (
                  <div key={index} className={rendering.has(index) ? "rendering" : undefined}>
                    {mark && state && (
                      <span className={`gutter ${state}`}>
                        {mark.first && (
                          <button
                            className="mark"
                            title={`Functional spec ${mark.frid} - ${STATE_LABEL[state]}`}
                            aria-label={`Functional spec ${mark.frid}, ${STATE_LABEL[state]}`}
                            onClick={() => void markerMenu(mark.frid)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              void markerMenu(mark.frid);
                            }}
                          >
                            {state === "now" ? <Spinner /> : state === "built" ? <Icon name="check" size={12} /> : null}
                          </button>
                        )}
                      </span>
                    )}
                    {line === "" ? "\u200b" : coloured ? tokens.map((token, at) => (token.role ? <span key={at} className={`plain-${token.role}`}>{token.text}</span> : token.text)) : line}
                  </div>
                );
              })}
            </pre>
            <textarea
              ref={areaRef}
              spellCheck={false}
              value={text}
              onChange={(event) => setText(event.target.value)}
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
          </div>
        )}
      </div>
    </div>
  );
}
