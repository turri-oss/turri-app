import { useEffect, useState } from "react";
import type { Usage } from "./types.ts";

/** Re-render once a second while `active`: for clocks that count up. */
export function useTick(active = true) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
}

export function elapsed(since: number, until = Date.now()): string {
  const seconds = Math.max(0, Math.round((until - since) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function cost(usage: Usage | undefined): string {
  if (usage === undefined || usage.cost === 0) return "";
  return `$${usage.cost.toFixed(usage.cost < 1 ? 3 : 2)}`;
}

export function tokens(usage: Usage | undefined): string {
  if (usage === undefined) return "";
  const total = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  if (total === 0) return "";
  return total >= 1_000_000 ? `${(total / 1_000_000).toFixed(1)}M tok` : `${(total / 1000).toFixed(1)}k tok`;
}

export function relativeDate(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The theme as it shows now: dark or light, the system's when it follows the system. */
function useShownTheme(): "dark" | "light" {
  const read = (): "dark" | "light" => {
    const chosen = document.documentElement.dataset.theme;
    if (chosen === "light" || chosen === "dark") return chosen;
    return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  };
  const [shown, setShown] = useState(read);
  useEffect(() => {
    const update = () => setShown(read());
    const media = matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      media.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);
  return shown;
}

const FRAMES = 12;

/**
 * The jellyfish turri is named after, from turri's own frames (assets/jellyfish): a stroke every three seconds, a
 * quarter second a frame. At rest it hangs open; `swimming`, it strokes - while turri works.
 */
export function Jellyfish({ size = 48, swimming = true, className = "" }: { size?: number; swimming?: boolean; className?: string }) {
  const theme = useShownTheme();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!swimming) {
      setFrame(0);
      return;
    }
    const timer = setInterval(() => setFrame((at) => (at + 1) % FRAMES), 250);
    return () => clearInterval(timer);
  }, [swimming]);
  return (
    <img
      className={`jellyfish ${className}`}
      src={`./jellyfish/${theme}-${String(frame).padStart(2, "0")}.png`}
      width={size}
      height={Math.round((size * 26) / 24)}
      alt=""
      draggable={false}
    />
  );
}

/** Dark, light or as the system is: the same choice as View > Appearance. */
export function Appearance() {
  const [theme, setTheme] = useState<string>(document.documentElement.dataset.theme ?? "dark");
  useEffect(() => {
    void window.turri.theme().then(setTheme);
    return window.turri.on("theme", setTheme);
  }, []);
  return (
    <div className="appearance" role="radiogroup" aria-label="Appearance">
      {(["dark", "light", "system"] as const).map((name) => (
        <button key={name} role="radio" aria-checked={theme === name} className={theme === name ? "on" : ""} onClick={() => void window.turri.setTheme(name)}>
          {name === "dark" ? "Dark" : name === "light" ? "Light" : "System"}
        </button>
      ))}
    </div>
  );
}

/** SF Symbols-like line icons, drawn inline so the app needs no icon font. */
const PATHS: Record<string, string> = {
  doc: "M6 2.5h5.5L15 6v11.5H6zM11.5 2.5V6H15",
  play: "M7 4.5v11l9-5.5z",
  stop: "M6 6h8v8H6z",
  eye: "M2.5 10s3-5.5 7.5-5.5S17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10zM10 12.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z",
  check: "M5 10.5l3.2 3L15 6.5",
  dot: "M10 10m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
  folder: "M2.5 5.5h5l1.5 1.5h8.5v8.5h-15z",
  clock: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 6v4l2.5 2",
  branch: "M6 4v12M6 9c0-2 8-1 8-5M14 4v0",
  code: "M7.5 6L3.5 10l4 4M12.5 6l4 4-4 4",
  spark: "M10 2.5l1.6 4.9 4.9 1.6-4.9 1.6L10 15.5l-1.6-4.9L3.5 9l4.9-1.6z",
  warn: "M10 3l7.5 13h-15zM10 8v3.5M10 13.5v.5",
  x: "M5.5 5.5l9 9M14.5 5.5l-9 9",
  layers: "M10 3l7 3.5-7 3.5-7-3.5zM3 10l7 3.5 7-3.5M3 13.5L10 17l7-3.5",
  test: "M7 3h6M8 3v5l-4.5 8.5h13L12 8V3",
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name] ?? PATHS.dot} />
    </svg>
  );
}

/** Working: four pixels chasing each other round a square. */
export function Spinner() {
  return (
    <span className="spinner" aria-label="working">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={34} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

/** ***plain text with its :Concepts: and `literals` set apart - for spec cards, not the editor. */
export function PlainText({ text }: { text: string }) {
  const parts = text.split(/(:[A-Za-z][\w.\-]*:|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, index) =>
        /^:[A-Za-z][\w.\-]*:$/.test(part) ? (
          <span key={index} className="concept">
            {part.slice(1, -1)}
          </span>
        ) : part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
          <code key={index}>{part.slice(1, -1)}</code>
        ) : (
          part
        ),
      )}
    </>
  );
}
