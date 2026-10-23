import type { IBuffer } from "@xterm/headless";

/**
 * What turri's terminal tools send the preview's terminal as a keyboard and a mouse would (electron/terminal.ts): the
 * bytes of a key and its modifiers, the modes a program turns on for them - mouse reporting, application cursor keys -
 * the bytes of a click or a turn of the wheel in each mouse encoding, and the cell of the screen a piece of text is on.
 */

// ---------- keys ----------

/** The keys turri may name, beside a single character: what terminal_press and terminal_type take. */
export const KEY_NAMES = ["enter", "tab", "escape", "backspace", "delete", "insert", "space", "up", "down", "left", "right", "home", "end", "pageup", "pagedown", "f1-f12"];

const GRAMMAR = `A key is its modifiers - ctrl, alt, shift - joined by + to one key: a single character, or ${KEY_NAMES.join(", ")} - such as ctrl+q, shift+tab, ctrl+shift+up, f5, enter, a.`;

const ESC = "\x1b";
const CSI = `${ESC}[`;
const SS3 = `${ESC}O`;

/** Keys a terminal sends as CSI and a letter - SS3 and the letter with application cursor keys on - and their modified form. */
const LETTERED: Record<string, string> = { up: "A", down: "B", right: "C", left: "D", home: "H", end: "F" };
/** F1-F4: SS3 and a letter, and CSI 1 ; m and the letter modified. */
const FUNCTION_LETTERED: Record<string, string> = { f1: "P", f2: "Q", f3: "R", f4: "S" };
/** Keys a terminal sends as CSI, a number and ~. */
const TILDED: Record<string, number> = { insert: 2, delete: 3, pageup: 5, pagedown: 6, f5: 15, f6: 17, f7: 18, f8: 19, f9: 20, f10: 21, f11: 23, f12: 24 };
/** Keys of one byte. */
const PLAIN: Record<string, string> = { enter: "\r", tab: "\t", escape: ESC, esc: ESC, backspace: "\x7f", space: " " };
/** ctrl with these sends a control code of its own. */
const CTRL_CODES: Record<string, string> = { " ": "\x00", "@": "\x00", "[": ESC, "\\": "\x1c", "]": "\x1d", "^": "\x1e", _: "\x1f", "?": "\x7f" };
/** ctrl with these letters sends what a key of its own sends: the terminal cannot tell them apart. */
const SAME_AS: Record<string, string> = { i: "tab", m: "enter", j: "enter", "[": "escape" };

export interface Key {
  /** What the terminal is sent. */
  bytes: string;
  /** The key as it was named, for what turri is told it pressed. */
  name: string;
  /** What it sends the same as, when the terminal cannot tell it from another key: said back to turri. */
  same?: string;
  /** It starts with ESC as a key of its own - escape, or alt and a key: the next key waits, or it reads as alt and that key. */
  escapes: boolean;
}

/** A key with its modifiers - ctrl+q, shift+tab, ctrl+shift+up, f5, a - as the bytes an xterm sends for it. */
export function keyBytes(spec: string, { applicationCursor = false }: { applicationCursor?: boolean } = {}): Key {
  // The modifiers, joined by + (or -, as terminal_type's keys were: ctrl-c), then the key - which may be + or - itself.
  const parsed = /^((?:(?:ctrl|control|alt|meta|option|opt|shift)[+-])*)(.+)$/i.exec(spec.trim());
  if (parsed === null) throw new Error(`No such key: ${JSON.stringify(spec)}. ${GRAMMAR}`);
  const mods = parsed[1]!.toLowerCase().split(/[+-]/).filter(Boolean);
  const ctrl = mods.some((mod) => mod === "ctrl" || mod === "control");
  const alt = mods.some((mod) => mod === "alt" || mod === "meta" || mod === "option" || mod === "opt");
  const shift = mods.includes("shift");
  const raw = parsed[2]!;
  const key = raw.length === 1 ? raw : raw.toLowerCase();
  const name = spec.trim();
  const said = (bytes: string, same?: string): Key => ({ bytes, name, ...(same !== undefined ? { same } : {}), escapes: bytes === ESC || (alt && bytes.startsWith(ESC) && !bytes.startsWith(CSI) && !bytes.startsWith(SS3)) });
  const modifier = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0);
  const withAlt = (bytes: string) => (alt ? ESC + bytes : bytes);

  if (LETTERED[key] !== undefined) {
    const letter = LETTERED[key]!;
    return said(modifier > 1 ? `${CSI}1;${modifier}${letter}` : `${applicationCursor ? SS3 : CSI}${letter}`);
  }
  if (FUNCTION_LETTERED[key] !== undefined) return said(modifier > 1 ? `${CSI}1;${modifier}${FUNCTION_LETTERED[key]}` : `${SS3}${FUNCTION_LETTERED[key]}`);
  if (TILDED[key] !== undefined) return said(modifier > 1 ? `${CSI}${TILDED[key]};${modifier}~` : `${CSI}${TILDED[key]}~`);

  if (PLAIN[key] !== undefined) {
    const plain = key === "esc" ? "escape" : key;
    if (plain === "tab" && shift) return said(withAlt(`${CSI}Z`), ctrl ? "shift+tab" : undefined);
    if (plain === "space" && ctrl) return said(withAlt("\x00"), shift ? "ctrl+space" : undefined);
    if (plain === "backspace" && ctrl) return said(withAlt("\x08"), shift ? "ctrl+backspace" : undefined);
    // enter, tab, escape, space and backspace send the same with shift or ctrl as without.
    const unheard = [ctrl && "ctrl", shift && "shift"].filter(Boolean);
    return said(withAlt(PLAIN[key]!), unheard.length > 0 ? (alt ? `alt+${plain}` : plain) : undefined);
  }

  if ([...key].length !== 1) throw new Error(`No such key: ${JSON.stringify(spec)}. ${GRAMMAR}`);

  if (ctrl) {
    const lower = key.toLowerCase();
    const prefix = alt ? "alt+" : "";
    if (/^[a-z]$/.test(lower)) {
      const bytes = String.fromCharCode(lower.charCodeAt(0) & 0x1f);
      const same = SAME_AS[lower] !== undefined ? prefix + SAME_AS[lower] : shift || key !== lower ? `${prefix}ctrl+${lower}` : undefined;
      return said(withAlt(bytes), same);
    }
    if (CTRL_CODES[key] !== undefined) return said(withAlt(CTRL_CODES[key]!), SAME_AS[key] !== undefined ? prefix + SAME_AS[key] : shift ? `${prefix}ctrl+${key}` : undefined);
    // ctrl with a digit or another character sends that character alone.
    return said(withAlt(key), prefix + key);
  }
  if (shift) {
    const upper = key.toUpperCase();
    // shift with a letter is its capital; with anything else, the character as named - name the shifted one (!, not shift+1).
    return said(withAlt(upper), upper === key && key.toLowerCase() === key ? (alt ? `alt+${key}` : key) : undefined);
  }
  return said(withAlt(key));
}

// ---------- the modes a program turns on ----------

export type MouseTracking = "none" | "vt200" | "drag" | "any";
export type MouseEncoding = "x10" | "utf8" | "sgr" | "urxvt";

const TRACKING: Record<number, MouseTracking> = { 1000: "vt200", 1002: "drag", 1003: "any" };
const ENCODING: Record<number, MouseEncoding> = { 1005: "utf8", 1006: "sgr", 1015: "urxvt" };

/**
 * The modes a program in the terminal has turned on - which mouse events it hears and how they are written, and
 * application cursor keys - from what it prints: `CSI ? n h` sets, `CSI ? n l` resets, several in one (`CSI ? 1000;1006 h`),
 * and one cut across two pieces of output put back together. The headless xterm keeps the tracking mode and the cursor
 * keys too, but not the encoding, and nothing of its own can be put back when a program ends without turning them off:
 * so all of them are kept here, by the program that turned them on.
 */
export function createModes() {
  let tracking: MouseTracking = "none";
  let encoding: MouseEncoding = "x10";
  let applicationCursor = false;
  /** What the end of the last output held of a sequence not yet ended. */
  let rest = "";

  function hear(data: string): boolean {
    const text = rest + data;
    let changed = false;
    for (const [, numbers, set] of text.matchAll(/\x1b\[\?([\d;]*)([hl])/g)) {
      for (const number of numbers!.split(";").map(Number)) {
        const on = set === "h";
        if (TRACKING[number] !== undefined) (tracking = on ? TRACKING[number]! : "none"), (changed = true);
        else if (ENCODING[number] !== undefined) (encoding = on ? ENCODING[number]! : encoding === ENCODING[number] ? "x10" : encoding), (changed = true);
        else if (number === 1) (applicationCursor = on), (changed = true);
      }
    }
    // A full reset (RIS) puts them all back.
    if (/\x1bc/.test(text)) reset(), (changed = true);
    rest = /\x1b(?:\[(?:\?[\d;]*)?)?$/.exec(text)?.[0] ?? "";
    return changed;
  }

  function reset() {
    tracking = "none";
    encoding = "x10";
    applicationCursor = false;
  }

  return {
    hear,
    reset,
    get tracking() {
      return tracking;
    },
    get encoding() {
      return encoding;
    },
    get applicationCursor() {
      return applicationCursor;
    },
  };
}

// ---------- the mouse ----------

export const BUTTONS = { left: 0, middle: 1, right: 2 } as const;
export const WHEEL = { up: 64, down: 65, left: 66, right: 67 } as const;
/** A move adds this to the button held. */
export const MOTION = 32;
/** A move with no button held: button 3, "none", moved. */
export const MOVED = MOTION | 3;
const MODIFIER_BITS = { shift: 4, alt: 8, ctrl: 16 } as const;

export type Modifier = keyof typeof MODIFIER_BITS;

export const modifierBits = (modifiers: readonly Modifier[] = []) => modifiers.reduce((bits, modifier) => bits | MODIFIER_BITS[modifier], 0);

/** One mouse event - a press, a release, a turn of the wheel, a move - at a cell (1-based), in the encoding the program asked for. */
export function mouseEvent(encoding: MouseEncoding, button: number, column: number, row: number, release = false): string {
  if (encoding === "sgr") return `${CSI}<${button};${column};${row}${release ? "m" : "M"}`;
  // The others cannot say which button was let go: a release is button 3, with the modifiers kept.
  const code = release ? (button & ~3) | 3 : button;
  if (encoding === "urxvt") return `${CSI}${code + 32};${column};${row}M`;
  if (encoding === "x10" && (column > 223 || row > 223)) throw new Error(`The program asked for the oldest mouse encoding, which cannot say a cell past the 223rd: row ${row}, column ${column} cannot be sent. Make the terminal smaller, or click nearer its top left.`);
  if (encoding === "utf8" && (column > 2015 || row > 2015)) throw new Error(`Row ${row}, column ${column} cannot be sent in the program's mouse encoding.`);
  return `${CSI}M${String.fromCharCode(32 + code)}${String.fromCodePoint(32 + column)}${String.fromCodePoint(32 + row)}`;
}

// ---------- where on the screen ----------

export interface Cell {
  row: number;
  column: number;
}

/** The visible screen's lines as text, and for each character of it the cell (0-based column) it is drawn in. */
export function screenLines(buffer: IBuffer, rows: number): Array<{ text: string; columns: number[]; widths: number[] }> {
  const lines: Array<{ text: string; columns: number[]; widths: number[] }> = [];
  for (let row = 0; row < rows; row++) {
    const line = buffer.getLine(buffer.viewportY + row);
    let text = "";
    const columns: number[] = [];
    const widths: number[] = [];
    if (line !== undefined) {
      for (let x = 0; x < line.length; x++) {
        const cell = line.getCell(x);
        // The second half of a wide character: drawn by the cell before it.
        if (cell === undefined || cell.getWidth() === 0) continue;
        const chars = cell.getChars() || " ";
        text += chars;
        // Each code unit of it is in this cell: a character past the BMP is two.
        for (let unit = 0; unit < chars.length; unit++) columns.push(x), widths.push(cell.getWidth());
      }
    }
    lines.push({ text, columns, widths });
  }
  return lines;
}

/** The visible screen as text, its trailing blanks left off. */
export function screenText(buffer: IBuffer, rows: number): string {
  return screenLines(buffer, rows)
    .map((line) => line.text.trimEnd())
    .join("\n")
    .replace(/\n+$/, "");
}

/** Every place the visible screen shows a piece of text, in reading order: the middle cell of each, 1-based. */
export function findText(buffer: IBuffer, rows: number, text: string): Cell[] {
  const found: Cell[] = [];
  screenLines(buffer, rows).forEach((line, row) => {
    for (let at = line.text.indexOf(text); at !== -1; at = line.text.indexOf(text, at + text.length)) {
      const first = line.columns[at]!;
      const end = at + text.length - 1;
      const last = line.columns[end]! + line.widths[end]! - 1;
      found.push({ row: row + 1, column: first + Math.floor((last - first) / 2) + 1 });
    }
  });
  return found;
}

/** The visible screen, each line numbered by its row and a column ruler above: to click or scroll by row and column. */
export function screenCells(buffer: IBuffer, rows: number, cols: number): string {
  const pad = String(rows).length;
  const tens = Array.from({ length: cols }, (_, x) => ((x + 1) % 10 === 0 ? String(Math.floor((x + 1) / 10) % 10) : " ")).join("");
  const units = Array.from({ length: cols }, (_, x) => String((x + 1) % 10)).join("");
  const lines = screenLines(buffer, rows).map((line, row) => `${String(row + 1).padStart(pad)}|${line.text.trimEnd()}`);
  return [`${" ".repeat(pad)}|${tens.trimEnd()}`, `${" ".repeat(pad)}|${units}`, ...lines].join("\n");
}
