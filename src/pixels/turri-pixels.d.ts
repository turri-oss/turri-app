// The types of turri-pixels.js, turri's pixel kit from the D5-Lean design: only what the window uses.

export interface Mounted {
  el: HTMLElement;
  destroy: () => void;
}

/** The still hero sprite, bobbing, its tentacles swaying between two frames. */
export function mountSprite(container: HTMLElement, stage?: "hero" | "polyp" | "budding" | "medusa" | "regrow", size?: number, options?: { motion?: boolean }): Mounted;

/** The hero's lifecycle: the polyp grows into the jellyfish, which idles, sinks and regrows - then idles on. */
export function mountJellyfish(container: HTMLElement, options?: { size?: number; motion?: boolean; frameMs?: number; loops?: number; holdFrames?: number }): Mounted;
