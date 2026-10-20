import { useEffect, useRef, useState } from "react";

interface OpenProject {
  id: number;
  name: string;
  dir: string;
  running: number;
  here: boolean;
}

/**
 * The projects open in every window (⇧⌘P), dropped from the top of the window: the one last in front first, typed to
 * filter, and the one chosen - with the arrows and enter, or a click - brought forward in its own window. It starts on
 * the project before this one, so ⇧⌘P and enter go back to it.
 */
export function ProjectSwitcher({ onClose }: { onClose: () => void }) {
  const [projects, setProjects] = useState<OpenProject[] | null>(null);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    void window.turri.openProjects().then((open) => {
      setProjects(open);
      setAt(open.length > 1 && open[0]!.here ? 1 : 0);
    });
  }, []);

  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  const matching = (projects ?? []).filter((project) => words.every((word) => `${project.name} ${project.dir}`.toLowerCase().includes(word)));
  const chosen = matching[Math.min(at, matching.length - 1)];

  useEffect(() => {
    list.current?.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  }, [at, query]);

  const choose = (project: OpenProject | undefined) => {
    onClose();
    if (project !== undefined && !project.here) void window.turri.switchProject(project.id);
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") setAt((now) => Math.min(now + 1, matching.length - 1));
    else if (event.key === "ArrowUp") setAt((now) => Math.max(now - 1, 0));
    else if (event.key === "Enter") choose(chosen);
    else if (event.key === "Escape") onClose();
    else return;
    event.preventDefault();
  };

  return (
    <div className="switcher-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="switcher" role="dialog" aria-label="switch project">
        <input
          className="switcher-search"
          autoFocus
          value={query}
          placeholder="switch to an open project"
          onChange={(event) => {
            setQuery(event.target.value);
            setAt(0);
          }}
          onKeyDown={onKey}
        />
        {projects !== null && matching.length === 0 && <p className="switcher-none muted">{projects.length === 0 ? "no project is open" : "no open project matches"}</p>}
        <ul className="switcher-list" ref={list} role="listbox">
          {matching.map((project) => (
            <li key={project.id}>
              <button role="option" aria-selected={project === chosen} className={project === chosen ? "on" : ""} onMouseMove={() => setAt(matching.indexOf(project))} onClick={() => choose(project)}>
                <span className="recent-name">{project.name}</span>
                {project.here && <span className="switcher-tag">this window</span>}
                {project.running > 0 && <span className="switcher-tag running">{project.running} running</span>}
                <span className="recent-path">{project.dir.replace(/^\/Users\/[^/]+/, "~")}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
