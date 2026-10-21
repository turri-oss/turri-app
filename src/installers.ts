import type { Check } from "../electron/preload.ts";
import { MAC } from "./platform.ts";

/**
 * What the window offers for a check that wants something done: where to get what is missing - an installer's page,
 * Apple's developer tools - or the sign-in sheet, for a model provider. turri doctor says what to do in a terminal's
 * words; these are for someone who has never opened one.
 */
export type Help = { label: string; url: string } | { label: string; action: "developer-tools" | "sign-in" };

/** Where each toolchain turri's stacks name is installed from: its makers' own download pages. */
const TOOLCHAINS: Record<string, string> = {
  Python: "https://www.python.org/downloads/",
  Node: "https://nodejs.org/en/download",
  Java: "https://adoptium.net/",
  Go: "https://go.dev/dl/",
  Rust: "https://rustup.rs/",
  Zig: "https://ziglang.org/download/",
  Odin: "https://odin-lang.org/docs/install/",
  Ruby: "https://www.ruby-lang.org/en/documentation/installation/",
  PHP: "https://www.php.net/downloads.php",
  Elixir: "https://elixir-lang.org/install.html",
};

const DEVELOPER_TOOLS: Help = { label: "install Apple's developer tools", action: "developer-tools" };

export function helpFor(check: Check): Help[] {
  if (check.level === "ok" || check.level === "info") return [];
  if (check.name === "Model provider") return [{ label: "sign in to a model provider…", action: "sign-in" }];
  if (check.name === "git") return MAC ? [DEVELOPER_TOOLS] : [{ label: "get git", url: "https://git-scm.com/downloads/linux" }];
  if (check.name === "bash") return MAC ? [DEVELOPER_TOOLS] : [];
  if (check.name === "OS sandbox") return MAC ? [] : [{ label: "get bubblewrap", url: "https://github.com/containers/bubblewrap#installation" }];
  // A module's toolchains: "install Python and Node on this machine - …".
  const named = /^install (.+?) on this machine/.exec(check.fix ?? "")?.[1]?.split(" and ") ?? [];
  return named.flatMap((toolchain): Help[] => {
    if (toolchain === "C/C++") return MAC ? [DEVELOPER_TOOLS] : [{ label: "get a C compiler", url: "https://gcc.gnu.org/install/binaries.html" }];
    const url = TOOLCHAINS[toolchain];
    return url === undefined ? [] : [{ label: `get ${toolchain}`, url }];
  });
}

/** What to do, in the window's words where turri's are a terminal's: the model provider is signed in to here. */
export function fixFor(check: Check): string | undefined {
  if (check.name === "Model provider" && check.level !== "ok") return "sign in with a subscription or an API key - or set a provider's API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, …) in your shell's profile, and start turri again.";
  return check.fix;
}
