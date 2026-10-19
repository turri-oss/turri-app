import { useEffect, useState } from "react";
import type { Project } from "./types.ts";
import { Appearance, Icon, Jellyfish, Spinner } from "./ui.tsx";

export function Welcome({ onOpened }: { onOpened: (project: Project | null) => void }) {
  const [recents, setRecents] = useState<string[]>([]);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.turri.recents().then(setRecents);
  }, []);

  const open = async (dir?: string) => {
    setError(null);
    setOpening(dir ?? "…");
    try {
      onOpened(dir === undefined ? await window.turri.chooseProject() : await window.turri.openProject(dir));
    } catch (failure) {
      setError(String((failure as Error).message ?? failure));
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="welcome">
      <div className="titlebar-space drag" />
      <div className="bubbles" aria-hidden>
        {Array.from({ length: 14 }, (_, index) => (
          <i key={index} style={{ left: `${(index * 37) % 100}%`, animationDelay: `${(index * 1.7) % 9}s`, animationDuration: `${8 + (index % 5) * 2}s` }} />
        ))}
      </div>
      <div className="welcome-card">
        <Jellyfish size={144} className="drift" />
        <div className="logo">turri</div>
        <p className="tagline">Describe your software in plain words. turri writes, tests and keeps the code in step with it.</p>
        <button className="button primary large" onClick={() => void open()} disabled={opening !== null}>
          {opening === "…" ? <Spinner /> : <Icon name="folder" />} Open a project…
        </button>
        {error && <p className="error-text">{error}</p>}
        {recents.length > 0 && (
          <>
            <div className="sidebar-section">Recent</div>
            <ul className="recents">
              {recents.map((dir) => (
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
        <Appearance />
      </div>
    </div>
  );
}
