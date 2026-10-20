import { useEffect, useState } from "react";

/** More recent projects than this, and the list scrolls and can be searched. */
const RECENTS_SHOWN = 5;
import type { Project } from "./types.ts";
import { Icon, Jellyfish, Spinner, TurriVersionLine } from "./ui.tsx";

export function Welcome({ onOpened, onNew }: { onOpened: (project: Project | null) => void; onNew: () => void }) {
  const [recents, setRecents] = useState<string[]>([]);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const searchable = recents.length > RECENTS_SHOWN;
  // By the folder's name or anywhere in its path, every word typed.
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  const matching = recents.filter((dir) => words.every((word) => dir.toLowerCase().includes(word)));

  useEffect(() => {
    void window.turri.recents().then(setRecents);
  }, []);

  const open = async (dir?: string) => {
    setError(null);
    setOpening(dir ?? "…");
    try {
      onOpened(dir === undefined ? await window.turri.chooseProject() : await window.turri.openProject(dir));
    } catch (failure) {
      // As the main process said it, without Electron's wrapping.
      setError(String((failure as Error).message ?? failure).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="welcome">
      {/* The name in the title bar, beside the window's buttons: the middle is the jellyfish's. */}
      <header className="welcome-bar drag">
        <Jellyfish size={30} swimming={false} />
        <span className="logo">turri</span>
      </header>
      <div className="bubbles" aria-hidden>
        {Array.from({ length: 14 }, (_, index) => (
          <i key={index} style={{ left: `${(index * 37) % 100}%`, animationDelay: `${(index * 1.7) % 9}s`, animationDuration: `${8 + (index % 5) * 2}s` }} />
        ))}
      </div>
      <div className="welcome-card">
        <Jellyfish size={150} lifecycle />
        <p className="tagline">
          the first coding agent with the power of <em>regenerative software</em>
        </p>
        <div className="welcome-actions">
          <button className="button primary large" onClick={onNew} disabled={opening !== null}>
            <Icon name="plus" /> start a new project…
          </button>
          <button className="button large" onClick={() => void open()} disabled={opening !== null}>
            {opening === "…" ? <Spinner /> : <Icon name="folder" />} open a project…
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
        {recents.length > 0 && (
          <>
            <div className="sidebar-section">recent</div>
            {searchable && (
              <input
                className="recents-search"
                type="search"
                value={query}
                placeholder={`search ${recents.length} projects`}
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  // Enter opens the first that matches; Escape clears the search.
                  if (event.key === "Enter" && matching[0] !== undefined) void open(matching[0]);
                  if (event.key === "Escape") setQuery("");
                }}
              />
            )}
            {matching.length === 0 && <p className="muted recents-none">no recent project matches “{query}”.</p>}
            <ul className={`recents ${searchable ? "scrolls" : ""}`}>
              {matching.map((dir) => (
                <li key={dir}>
                  <button onClick={() => void open(dir)} disabled={opening !== null}>
                    {opening === dir ? <Spinner /> : <Icon name="folder" />}
                    <span className="recent-name">{dir.split("/").at(-1)}</span>
                    <span className="recent-path">{dir.replace(/^\/Users\/[^/]+/, "~")}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <TurriVersionLine />
      </div>
    </div>
  );
}
