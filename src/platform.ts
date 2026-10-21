// macOS or Linux: the window says its keys and its file manager as each system does.

export const MAC = window.turri.platform === "darwin";

/** A shortcut as the system writes it: ⌘S and ⇧⌘P on macOS, Ctrl+S and Ctrl+Shift+P on Linux. */
export const keys = (key: string, shift = false) => (MAC ? `${shift ? "⇧" : ""}⌘${key}` : `Ctrl+${shift ? "Shift+" : ""}${key}`);

/** The key a shortcut is pressed with: command on macOS, control on Linux. */
export const withMod = (event: { metaKey: boolean; ctrlKey: boolean }) => (MAC ? event.metaKey : event.ctrlKey);

/** Where a file is shown: Finder, or whichever file manager Linux has. */
export const REVEAL = MAC ? "reveal in Finder" : "show in the file manager";
