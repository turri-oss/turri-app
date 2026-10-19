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

/** The pixel jellyfish's box: the animated one's, which leaves room above it for its bob, in its pixels. */
const JELLYFISH_WIDTH = 279;
const JELLYFISH_HEIGHT = 449;
/** Below this, the jellyfish's pixels run together: the logo is drawn instead. */
const LOGO_BELOW = 48;

/**
 * The jellyfish turri is named after (public/jellyfish/). Large, the pixel jellyfish: at rest it hangs still, and
 * `swimming` it bobs, its tentacles stroking - while turri works. Small, the logo, which bobs in pixel steps instead.
 */
export function Jellyfish({ size = 48, swimming = true, className = "" }: { size?: number; swimming?: boolean; className?: string }) {
  if (size < LOGO_BELOW) {
    return <img className={`jellyfish logo-mark ${swimming ? "swimming" : ""} ${className}`} src="./jellyfish/logo.svg" width={size} height={size} alt="" draggable={false} />;
  }
  return (
    <img
      className={`jellyfish ${className}`}
      src={swimming ? "./jellyfish/jellyfish-swimming.svg" : "./jellyfish/jellyfish.svg"}
      width={size}
      height={Math.round((size * JELLYFISH_HEIGHT) / JELLYFISH_WIDTH)}
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
  release: "M10 13V3.5M6 7.5l4-4 4 4M4 12v4.5h12V12",
  eye: "M2.5 10s3-5.5 7.5-5.5S17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10zM10 12.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z",
  check: "M5 10.5l3.2 3L15 6.5",
  dot: "M10 10m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
  folder: "M2.5 5.5h5l1.5 1.5h8.5v8.5h-15z",
  plus: "M10 4v12M4 10h12",
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
