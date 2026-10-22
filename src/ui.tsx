import { useEffect, useRef, useState } from "react";
import { mountJellyfish, mountSprite, type Mounted } from "./pixels/turri-pixels.js";
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

/** The hero jellyfish's box, in its pixels: jellyfish-hero.svg's, and the swaying sprite's, which bobs inside it. */
const HERO_WIDTH = 350;
const HERO_HEIGHT = 460;
/** The lifecycle's box: the polyp on the floor at its foot, the jellyfish risen to where the hero hangs. */
const LIFECYCLE_WIDTH = 400;
const LIFECYCLE_HEIGHT = 600;
/** Below this, the jellyfish's pixels run together: the logo is drawn instead. */
const LOGO_BELOW = 48;

/**
 * The jellyfish turri is named after, from turri's pixel kit (src/pixels/, public/jellyfish/). Large: at rest the hero
 * hangs still; `swimming` it bobs, its tentacles swaying - while turri works; `lifecycle`, it grows from the polyp,
 * sinks and grows again, then sways on. Small: the logo mark at rest, and the mascot, bobbing, while turri works.
 */
export function Jellyfish({ size = 48, swimming = true, lifecycle = false, className = "" }: { size?: number; swimming?: boolean; lifecycle?: boolean; className?: string }) {
  if (size < LOGO_BELOW) {
    return (
      <img
        className={`jellyfish logo-mark ${swimming ? "swimming" : ""} ${className}`}
        src={swimming ? "./jellyfish/jelly-mascot.svg" : "./jellyfish/logo-mark.svg"}
        width={size}
        height={size}
        alt=""
        draggable={false}
      />
    );
  }
  if (lifecycle) return <Pixels size={size} width={LIFECYCLE_WIDTH} height={LIFECYCLE_HEIGHT} mount={(host) => mountJellyfish(host)} className={className} />;
  if (swimming) return <Pixels size={size} width={HERO_WIDTH} height={HERO_HEIGHT} mount={(host) => mountSprite(host, "hero")} className={className} />;
  return <img className={`jellyfish ${className}`} src="./jellyfish/jellyfish-hero.svg" width={size} height={Math.round((size * HERO_HEIGHT) / HERO_WIDTH)} alt="" draggable={false} />;
}

/** One of the kit's animations, mounted in its own pixels' box and scaled to `size` wide. */
function Pixels({ size, width, height, mount, className }: { size: number; width: number; height: number; mount: (host: HTMLElement) => Mounted; className: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (host.current === null) return;
    const mounted = mount(host.current);
    return () => mounted.destroy();
  }, []);
  const scale = size / width;
  return (
    <div className={`jellyfish pixels ${className}`} style={{ width: size, height: Math.round(height * scale) }} aria-hidden>
      <div ref={host} style={{ position: "relative", width, height, transform: `scale(${scale})`, transformOrigin: "0 0" }} />
    </div>
  );
}

/** SF Symbols-like line icons, drawn inline so the app needs no icon font. */
const PATHS: Record<string, string> = {
  doc: "M6 2.5h5.5L15 6v11.5H6zM11.5 2.5V6H15",
  file: "M6 2.5h5.5L15 6v11.5H6zM11.5 2.5V6H15M8.5 10h4M8.5 13h4",
  chevron: "M8 5.5l4.5 4.5L8 14.5",
  play: "M7 4.5v11l9-5.5z",
  stop: "M6 6h8v8H6z",
  eye: "M2.5 10s3-5.5 7.5-5.5S17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10zM10 12.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z",
  check: "M5 10.5l3.2 3L15 6.5",
  checks: "M2.5 10.5l3.2 3L12.5 6.5M9 13l.5.5L17.5 6.5",
  dot: "M10 10m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
  folder: "M2.5 5.5h5l1.5 1.5h8.5v8.5h-15z",
  plus: "M10 4v12M4 10h12",
  clock: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 6v4l2.5 2",
  branch: "M6 4v12M6 9c0-2 8-1 8-5M14 4v0",
  code: "M7.5 6L3.5 10l4 4M12.5 6l4 4-4 4",
  spark: "M10 2.5l1.6 4.9 4.9 1.6-4.9 1.6L10 15.5l-1.6-4.9L3.5 9l4.9-1.6z",
  warn: "M10 3l7.5 13h-15zM10 8v3.5M10 13.5v.5",
  x: "M5.5 5.5l9 9M14.5 5.5l-9 9",
  copy: "M7.5 7.5h9v9h-9zM4.5 12.5v-8h8",
  layers: "M10 3l7 3.5-7 3.5-7-3.5zM3 10l7 3.5 7-3.5M3 13.5L10 17l7-3.5",
  test: "M7 3h6M8 3v5l-4.5 8.5h13L12 8V3",
  back: "M12 5.5L7.5 10l4.5 4.5",
  forward: "M8 5.5l4.5 4.5L8 14.5",
  reload: "M15.5 10a5.5 5.5 0 1 1-1.6-3.9M15.5 3.5v3h-3",
  key: "M13 3.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM10.5 9.5l-7 7M5.5 14.5l2 2M7.5 12.5l1.5 1.5",
  sidebar: "M3 4.5h14v11H3zM8 4.5v11",
  gear: "M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM10 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM10 2.5V5M10 15v2.5M2.5 10H5M15 10h2.5M4.7 4.7l1.8 1.8M13.5 13.5l1.8 1.8M4.7 15.3l1.8-1.8M13.5 6.5l1.8-1.8",
  globe: "M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM2.5 10h15M10 2.5c2 2 3 4.5 3 7.5s-1 5.5-3 7.5c-2-2-3-4.5-3-7.5s1-5.5 3-7.5z",
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name] ?? PATHS.dot} />
    </svg>
  );
}

/**
 * ***plain's own mark - its three asterisks, in its green (public/plain/plain-mark.svg) - for a .plain file wherever
 * one is named. `size` is its width: it is about half as high.
 */
export function PlainMark({ size = 16 }: { size?: number }) {
  return <img className="plain-mark" src="./plain/plain-mark.svg" width={size} height={Math.round((size * 243.9) / 439.2)} alt="" draggable={false} />;
}

/** ***plain as the window writes its name: its mark, then plain - copied as ***plain. */
export function PlainName() {
  return (
    <span className="plain-name">
      <img className="plain-mark" src="./plain/plain-mark.svg" alt="***" draggable={false} />
      plain
    </span>
  );
}

/** Words with ***plain in them, each ***plain written as its name is: for what a string brings to the window. */
export function withPlain(text: string): React.ReactNode {
  const parts = text.split("***plain");
  // One span, so that a flex parent - a notice, a pulse's line in work - lays it out as the one run of words it is.
  return parts.length === 1 ? text : <span>{parts.flatMap((part, at) => (at === 0 ? [part] : [<PlainName key={at} />, part]))}</span>;
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
      <h3>{withPlain(title)}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

/** Which turri the app runs - from npm, or a clone's sources at a commit - and, in amber, anything to do about it. */
export function TurriVersionLine() {
  const [version, setVersion] = useState<Awaited<ReturnType<typeof window.turri.turriVersion>> | null>(null);
  useEffect(() => void window.turri.turriVersion().then(setVersion).catch(() => {}), []);
  if (version === null) return null;
  return (
    <div className={`turri-version ${version.warning ? "warning" : ""}`} title={version.warning ? `${version.warning}\n\n${version.detail}` : version.detail}>
      {version.warning && <Icon name="warn" size={12} />}
      <span>
        turri {version.from === "npm" ? `${version.label} · npm` : `local · ${version.label}`}
      </span>
      {version.warning && <span className="turri-version-warning">{version.warning}</span>}
    </div>
  );
}
