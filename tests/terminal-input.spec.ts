import headless from "@xterm/headless";
import { expect, test } from "@playwright/test";
import { createModes, findText, keyBytes, mouseEvent, screenCells } from "../electron/terminal-input.ts";

// What turri's terminal tools send as a keyboard and a mouse would: no window, no shell - the bytes alone.
const ESC = "\x1b";
const { Terminal: Screen } = headless;

test.describe("a key turri presses", () => {
  test("is sent as an xterm sends it", () => {
    const table: Record<string, string> = {
      a: "a",
      A: "A",
      "+": "+",
      "ctrl+q": "\x11",
      "CTRL+Q": "\x11",
      "ctrl-c": "\x03",
      "ctrl+space": "\x00",
      "ctrl+\\": "\x1c",
      "ctrl+]": "\x1d",
      "ctrl+^": "\x1e",
      "ctrl+_": "\x1f",
      "shift+a": "A",
      "alt+x": `${ESC}x`,
      "meta+x": `${ESC}x`,
      "option+x": `${ESC}x`,
      "alt+ctrl+c": `${ESC}\x03`,
      enter: "\r",
      tab: "\t",
      "shift+tab": `${ESC}[Z`,
      escape: ESC,
      esc: ESC,
      backspace: "\x7f",
      "ctrl+backspace": "\x08",
      space: " ",
      delete: `${ESC}[3~`,
      insert: `${ESC}[2~`,
      pageup: `${ESC}[5~`,
      PageDown: `${ESC}[6~`,
      home: `${ESC}[H`,
      end: `${ESC}[F`,
      up: `${ESC}[A`,
      down: `${ESC}[B`,
      right: `${ESC}[C`,
      left: `${ESC}[D`,
      f1: `${ESC}OP`,
      f2: `${ESC}OQ`,
      f3: `${ESC}OR`,
      f4: `${ESC}OS`,
      f5: `${ESC}[15~`,
      f6: `${ESC}[17~`,
      f7: `${ESC}[18~`,
      f8: `${ESC}[19~`,
      f9: `${ESC}[20~`,
      f10: `${ESC}[21~`,
      f11: `${ESC}[23~`,
      f12: `${ESC}[24~`,
      "ctrl+up": `${ESC}[1;5A`,
      "shift+right": `${ESC}[1;2C`,
      "alt+left": `${ESC}[1;3D`,
      "ctrl+shift+up": `${ESC}[1;6A`,
      "ctrl+delete": `${ESC}[3;5~`,
      "shift+f5": `${ESC}[15;2~`,
      "ctrl+f1": `${ESC}[1;5P`,
      "shift+pageup": `${ESC}[5;2~`,
    };
    for (const [name, bytes] of Object.entries(table)) expect(keyBytes(name).bytes, name).toBe(bytes);
  });

  test("sends arrows and home and end as application cursor keys when the program turned them on", () => {
    expect(keyBytes("up", { applicationCursor: true }).bytes).toBe(`${ESC}OA`);
    expect(keyBytes("left", { applicationCursor: true }).bytes).toBe(`${ESC}OD`);
    expect(keyBytes("home", { applicationCursor: true }).bytes).toBe(`${ESC}OH`);
    // A modified one is the same either way.
    expect(keyBytes("ctrl+up", { applicationCursor: true }).bytes).toBe(`${ESC}[1;5A`);
  });

  test("says what it sends the same as, when the terminal cannot tell the two apart", () => {
    const same = (name: string) => keyBytes(name).same;
    expect(same("ctrl+i")).toBe("tab");
    expect(same("ctrl+m")).toBe("enter");
    expect(same("ctrl+j")).toBe("enter");
    expect(same("ctrl+[")).toBe("escape");
    expect(keyBytes("ctrl+[").bytes).toBe(ESC);
    expect(same("ctrl+shift+a")).toBe("ctrl+a");
    expect(keyBytes("ctrl+shift+a").bytes).toBe("\x01");
    expect(same("ctrl+5")).toBe("5");
    expect(keyBytes("ctrl+5").bytes).toBe("5");
    expect(same("shift+enter")).toBe("enter");
    expect(same("ctrl+q")).toBeUndefined();
    expect(same("shift+tab")).toBeUndefined();
  });

  test("knows which keys start with an escape of their own, for the pause after them", () => {
    expect(keyBytes("escape").escapes).toBe(true);
    expect(keyBytes("alt+x").escapes).toBe(true);
    expect(keyBytes("up").escapes).toBe(false);
    expect(keyBytes("alt+up").escapes).toBe(false);
    expect(keyBytes("a").escapes).toBe(false);
  });

  test("names the grammar for a key outside it", () => {
    expect(() => keyBytes("hyper+x")).toThrow(/No such key: "hyper\+x"\. A key is its modifiers - ctrl, alt, shift - joined by \+/);
    expect(() => keyBytes("f13")).toThrow(/f1-f12/);
    expect(() => keyBytes("ctrl+")).toThrow(/No such key/);
  });
});

test.describe("the modes a program turns on", () => {
  test("are heard from what it prints, several in one sequence", () => {
    const modes = createModes();
    expect([modes.tracking, modes.encoding, modes.applicationCursor]).toEqual(["none", "x10", false]);
    modes.hear("hello\x1b[?1000;1006hworld\x1b[?1h");
    expect([modes.tracking, modes.encoding, modes.applicationCursor]).toEqual(["vt200", "sgr", true]);
    modes.hear("\x1b[?1003h\x1b[?1015h");
    expect([modes.tracking, modes.encoding]).toEqual(["any", "urxvt"]);
    modes.hear("\x1b[?1006l");
    // Turning off what is not on leaves the encoding as it is.
    expect(modes.encoding).toBe("urxvt");
    modes.hear("\x1b[?1015l\x1b[?1002h");
    expect([modes.tracking, modes.encoding]).toEqual(["drag", "x10"]);
    modes.hear("\x1b[?1000l\x1b[?1l");
    expect([modes.tracking, modes.applicationCursor]).toEqual(["none", false]);
  });

  test("are heard when a sequence is cut across two pieces of output", () => {
    for (const cut of [1, 2, 3, 6, 8, 11]) {
      const modes = createModes();
      const sequence = "ab\x1b[?1003;1006h";
      modes.hear(sequence.slice(0, cut + 2));
      modes.hear(sequence.slice(cut + 2));
      expect([modes.tracking, modes.encoding], `cut after ${cut + 2}`).toEqual(["any", "sgr"]);
    }
  });

  test("are put back by a full reset, and by reset", () => {
    const modes = createModes();
    modes.hear("\x1b[?1000;1005h");
    modes.hear("\x1bc");
    expect([modes.tracking, modes.encoding]).toEqual(["none", "x10"]);
    modes.hear("\x1b[?1002h");
    modes.reset();
    expect(modes.tracking).toBe("none");
  });
});

test.describe("a mouse event", () => {
  test("is written in the encoding the program asked for", () => {
    // SGR: pressed M, let go m, the button as it is.
    expect(mouseEvent("sgr", 0, 72, 6)).toBe(`${ESC}[<0;72;6M`);
    expect(mouseEvent("sgr", 0, 72, 6, true)).toBe(`${ESC}[<0;72;6m`);
    expect(mouseEvent("sgr", 2, 1, 1)).toBe(`${ESC}[<2;1;1M`);
    expect(mouseEvent("sgr", 0 | 16, 3, 4)).toBe(`${ESC}[<16;3;4M`);
    expect(mouseEvent("sgr", 65, 50, 15)).toBe(`${ESC}[<65;50;15M`);
    expect(mouseEvent("sgr", 35, 9, 9)).toBe(`${ESC}[<35;9;9M`);
    // URXVT: the button plus 32, a release as button 3.
    expect(mouseEvent("urxvt", 0, 72, 6)).toBe(`${ESC}[32;72;6M`);
    expect(mouseEvent("urxvt", 1, 72, 6, true)).toBe(`${ESC}[35;72;6M`);
    expect(mouseEvent("urxvt", 64, 10, 2)).toBe(`${ESC}[96;10;2M`);
    // X10: each a character, plus 32; a release keeps the modifiers.
    expect(mouseEvent("x10", 0, 1, 1)).toBe(`${ESC}[M !!`);
    expect(mouseEvent("x10", 0, 72, 6, true)).toBe(`${ESC}[M#${String.fromCharCode(104)}&`);
    expect(mouseEvent("x10", 4, 1, 1, true)).toBe(`${ESC}[M'!!`);
    expect(mouseEvent("x10", 67, 2, 3)).toBe(`${ESC}[Mc"#`);
    // UTF-8: the same, a coordinate past 95 a character of its own.
    expect(mouseEvent("utf8", 0, 300, 2)).toBe(`${ESC}[M ${String.fromCodePoint(332)}"`);
  });

  test("cannot say a cell past the 223rd in X10", () => {
    expect(mouseEvent("x10", 0, 223, 1)).toBe(`${ESC}[M ${String.fromCharCode(255)}!`);
    expect(() => mouseEvent("x10", 0, 224, 1)).toThrow(/cannot say a cell past the 223rd: row 1, column 224/);
    expect(() => mouseEvent("utf8", 0, 224, 1)).not.toThrow();
  });
});

test.describe("text on the screen", () => {
  const screenOf = async (lines: string[]) => {
    const screen = new Screen({ cols: 40, rows: 6, allowProposedApi: true });
    await new Promise<void>((resolve) => screen.write(lines.join("\r\n"), resolve));
    return screen;
  };

  test("is found by the cell it is drawn in, wide characters and all", async () => {
    const screen = await screenOf(["  ✎ 🗑 Add New Task", "中文 Add 中 Add"]);
    const buffer = screen.buffer.active;
    // 🗑 is two code units in one cell: "Add" starts at column 7, not 8.
    expect(findText(buffer, 6, "Add New Task")).toEqual([{ row: 1, column: 7 + 5 }]);
    expect(findText(buffer, 6, "🗑")).toEqual([{ row: 1, column: 5 }]);
    expect(findText(buffer, 6, "✎")).toEqual([{ row: 1, column: 3 }]);
    // 中 and 文 are two cells each: "Add" at 6-8, then 中 at 10-11, "Add" at 13-15.
    expect(findText(buffer, 6, "Add")).toEqual([
      { row: 1, column: 8 },
      { row: 2, column: 7 },
      { row: 2, column: 14 },
    ]);
    expect(findText(buffer, 6, "中")).toEqual([
      { row: 2, column: 1 },
      { row: 2, column: 10 },
    ]);
    expect(findText(buffer, 6, "nothing")).toEqual([]);
  });

  test("is shown by row and column, with a ruler", async () => {
    const screen = await screenOf(["hello", "", "  there"]);
    const cells = screenCells(screen.buffer.active, 6, 12).split("\n");
    expect(cells[0]).toBe(" |         1");
    expect(cells[1]).toBe(" |123456789012");
    expect(cells[2]).toBe("1|hello");
    expect(cells[4]).toBe("3|  there");
    expect(cells).toHaveLength(8);
  });
});
