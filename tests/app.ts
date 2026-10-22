import { _electron as electron, test as base, type ElectronApplication, type Page } from "@playwright/test";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The app as a test sees it: launched from source on the build in dist/, with everything it keeps elsewhere - its
 * userData, pi's credentials and sessions - in a folder of the test's own, and the fixture project copied there, so a
 * test changes neither the person's recents nor their ~/.pi/agent/auth.json nor the fixture itself.
 */

const ROOT = resolve(import.meta.dirname, "..");
const FIXTURE = join(ROOT, "tests", "fixture", "hello");

interface Launched {
  app: ElectronApplication;
  window: Page;
  /** The fixture project's copy: its folder, and its spec. */
  project: string;
  spec: string;
}

interface Options {
  /** Open the fixture project at start (TURRI_APP_OPEN), or leave the window on its welcome screen. */
  open: boolean;
  /** Recent projects the welcome screen lists: the fixture's copy, when true. */
  recent: boolean;
}

export const test = base.extend<Options & { launched: Launched; scratch: string }>({
  open: [true, { option: true }],
  recent: [false, { option: true }],

  scratch: async ({}, use) => {
    // Real paths: macOS's tmpdir is a link, and the app names a project by where it really is.
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), "turri-app-test-")));
    await use(scratch);
    rmSync(scratch, { recursive: true, force: true });
  },

  launched: async ({ scratch, open, recent }, use) => {
    const project = join(scratch, "hello");
    cpSync(FIXTURE, project, { recursive: true });
    const userData = join(scratch, "user-data");
    mkdirSync(userData);
    if (recent) writeFileSync(join(userData, "recent-projects.json"), JSON.stringify([project]));

    // Not the person's shell's environment (TERM set: shell-env.ts keeps the one given), nor a Vite server's window.
    const { VITE_DEV_SERVER_URL, TURRI_APP_SCREENSHOT, TURRI_APP_VIEW, TURRI_APP_OPEN, TURRI_APP_HIDDEN, ...env } = process.env;
    const app = await electron.launch({
      args: [ROOT, `--user-data-dir=${userData}`],
      cwd: ROOT,
      env: {
        ...(env as Record<string, string>),
        TERM: env.TERM ?? "dumb",
        PI_CODING_AGENT_DIR: join(scratch, "pi"),
        // The fixture's models are Anthropic's: a project opens with any key, and no test sends one a word.
        ANTHROPIC_API_KEY: "sk-ant-test",
        // Its windows drawn but never shown, and out of the Dock: a run takes neither the screen nor the focus.
        TURRI_APP_HIDDEN: "1",
        ...(open ? { TURRI_APP_OPEN: project } : {}),
      },
    });
    const window = await app.firstWindow();
    await use({ app, window, project, spec: join(project, "hello.plain") });
    await app.close();
  },
});

export { expect } from "@playwright/test";

/** What of ***plain the turri running gives the window - its standard library, the graph, concepts - once the project is open. */
export async function offers(window: Page): Promise<{ stdlib: boolean; links: boolean; concepts: boolean; resources: boolean }> {
  await window.locator(".tree-row").first().waitFor();
  return window.evaluate(() =>
    (window as unknown as { turri: { call: (method: string) => Promise<{ offers: { stdlib: boolean; links: boolean; concepts: boolean; resources: boolean } }> } }).turri.call("summary").then((summary) => summary.offers),
  );
}
