import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "./app.ts";

/** The engine the app runs for its project: its main process's child running engine/engine.mjs. */
function enginePid(main: number): number | undefined {
  const children = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" })
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match) => match !== null && Number(match[2]) === main && match[3]!.includes("engine.mjs"));
  return children[0] ? Number(children[0][1]) : undefined;
}

test.describe("the engine", () => {
  test("stopped under the window, says so until it is started again, and starts again at a click", async ({ launched: { app, window, project } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const main = app.process().pid!;
    const first = enginePid(main);
    expect(first).toBeDefined();
    process.kill(first!, "SIGKILL");
    const notice = window.getByRole("alert");
    await expect(notice).toContainText("the turri engine stopped");
    await notice.getByRole("button", { name: "start it again" }).click();
    await expect(notice).toHaveCount(0);
    await expect.poll(() => enginePid(main), { timeout: 15_000 }).not.toBe(first);
    expect(enginePid(main)).toBeDefined();
    // It answers: a slash command that only prints, no model called.
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await box.fill("/stdlib");
    await box.press("Enter");
    await expect(window.locator(".chat-body")).toContainText("The plain standard library", { timeout: 15_000 });
  });
});

test.describe("the engine, with NODE_OPTIONS from the login shell that Electron's Node does not take", () => {
  test.use({ env: { TURRI_APP_SHELL_ENV: "1", SHELL: join(import.meta.dirname, "node-options-shell.sh") } });

  test("starts all the same, and answers", async ({ launched: { window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await box.fill("/stdlib");
    await box.press("Enter");
    await expect(window.locator(".chat-body")).toContainText("The plain standard library", { timeout: 15_000 });
  });
});
