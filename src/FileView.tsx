import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Empty, Icon, Spinner } from "./ui.tsx";

type Token = { text: string; role: string | null };
type Read = { file: string; text: string | null; reason?: "large" | "binary"; size: number };

/** Folders whose files turri writes and writes again: shown, not edited here - an edit would be lost to the next pulse. */
const GENERATED = ["plain_modules", "dist", ".turri"];

function kilobytes(size: number) {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;
}

/**
 * Any file of the project that is not one of its specs: a template a spec imports, a test script, a readme, a skill. It
 * is edited as text - a .plain file coloured by turri's grammar, as the spec is - and saved with ⌘S; what turri
 * generates is read only. A file that is not text, or too large, is offered to the app that opens it.
 */
export function FileView(props: { root: string; file: string; onDirty: (dirty: boolean) => void; saveRef: MutableRefObject<(() => Promise<void>) | null>; say: (text: string, tone?: "info" | "error") => void }) {
  const { root, file } = props;
  const rel = file.slice(root.length + 1);
  const readOnly = GENERATED.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
  const plain = file.endsWith(".plain");
  const [read, setRead] = useState<Read | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [lines, setLines] = useState<Token[][]>([]);
  const [saving, setSaving] = useState(false);
  const [onDisk, setOnDisk] = useState<string | null>(null);
  const now = useRef({ text, saved });
  now.current = { text, saved };

  useEffect(() => {
    window.turri
      .call<Read>("readFile", { file })
      .then((next) => {
        setRead(next);
        setText(next.text);
        setSaved(next.text);
      })
      .catch((error: Error) => setFailed(error.message));
  }, [file]);

  // Changed on disk: taken at once, unless there are edits it would undo.
  useEffect(
    () =>
      window.turri.on("engine:files", ({ paths }: { paths: string[] }) => {
        if (!paths.includes(file)) return;
        void window.turri.call<Read>("readFile", { file }).then(
          (next) => {
            if (next.text === null || next.text === now.current.saved) return;
            if (now.current.text === now.current.saved || now.current.text === next.text) {
              setText(next.text);
              setSaved(next.text);
              setOnDisk(null);
            } else setOnDisk(next.text);
          },
          () => setFailed(`${rel} is no longer there.`),
        );
      }),
    [file, rel],
  );

  // A .plain file coloured as turri's grammar has it, a moment after typing stops.
  useEffect(() => {
    if (!plain || text === null) return;
    const timer = setTimeout(() => void window.turri.call<Token[][]>("highlightSpec", { text }).then(setLines), 80);
    return () => clearTimeout(timer);
  }, [plain, text]);

  const dirty = text !== null && text !== saved;
  useEffect(() => props.onDirty(dirty), [dirty]);

  const save = async () => {
    if (text === null || !dirty || readOnly) return;
    setSaving(true);
    try {
      await window.turri.call("writeFile", { file, text });
      setSaved(text);
      setOnDisk(null);
    } catch (error) {
      props.say(`Not saved: ${(error as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };
  props.saveRef.current = save;

  const header = (
    <div className="pane-header">
      <span>
        <Icon name={plain ? "doc" : "file"} /> {rel}
      </span>
      <span className="pane-header-right">
        <button className="link" onClick={() => void window.turri.openPath(file)} title="Open it in the app your Mac opens it with">
          Open
        </button>
        <span className="muted">·</span>
        <button className="link" onClick={() => void window.turri.reveal(file)}>
          Reveal
        </button>
        <span className="muted">·</span>
        {readOnly ? (
          <span className="muted" title="turri writes this file: an edit here would be lost to the next pulse">
            Generated - read only
          </span>
        ) : dirty ? (
          <button className="button small" onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner /> : null} Save <kbd>⌘S</kbd>
          </button>
        ) : (
          <span className="muted">Saved</span>
        )}
      </span>
    </div>
  );

  if (failed !== null)
    return (
      <div className="editor-pane">
        <Empty icon="warn" title="Cannot read this file">
          {failed}
        </Empty>
      </div>
    );
  if (read === null || (read.text !== null && text === null))
    return (
      <div className="center">
        <Spinner />
      </div>
    );
  if (text === null)
    return (
      <div className="editor-pane">
        {header}
        <Empty icon="file" title={read.reason === "large" ? `Too large to show here (${kilobytes(read.size)})` : "Not a text file"}>
          Open it in the app your Mac opens it with, or reveal it in Finder.
        </Empty>
      </div>
    );

  return (
    <div className="editor-pane">
      {header}
      {onDisk !== null && (
        <div className="disk-banner">
          <Icon name="warn" />
          <span>{rel} changed on disk while you were editing it.</span>
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
      {/* The two layers of the spec's editor: the text drawn, coloured for a .plain file, and the textarea laid over it. */}
      <div className="editor">
        <div className="editor-sheet file-sheet">
          <pre className="editor-colours" aria-hidden>
            {text.split("\n").map((line, index) => {
              const tokens = plain ? lines[index] : undefined;
              const coloured = tokens !== undefined && tokens.map((token) => token.text).join("") === line;
              return <div key={index}>{line === "" ? "​" : coloured ? tokens.map((token, at) => (token.role ? <span key={at} className={`plain-${token.role}`}>{token.text}</span> : token.text)) : line}</div>;
            })}
          </pre>
          <textarea
            spellCheck={false}
            value={text}
            readOnly={readOnly}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "s" && event.metaKey) {
                event.preventDefault();
                void save();
              }
              if (event.key === "Tab" && !readOnly) {
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
    </div>
  );
}
