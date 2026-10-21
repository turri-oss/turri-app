/** The key a shortcut is pressed with, as src/platform.ts has it: ⌘ on macOS, Ctrl elsewhere. */
export const keys = { mod: process.platform === "darwin" ? "Meta" : "Control" };
