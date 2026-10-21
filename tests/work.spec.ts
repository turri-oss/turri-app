import { expect, test } from "./app.ts";

/** A pulse as the engine sends it, done: it rendered one line of hello.plain, its functional specs' second. */
const pulse = () => ({
  id: "p1",
  kind: "regenerate",
  summary: "hello: the greeting by name",
  module: "hello",
  pulse: 1,
  title: "the greeting by name",
  diff: "diff --git a/hello.plain b/hello.plain\n--- a/hello.plain\n+++ b/hello.plain\n@@ -13,1 +13,2 @@\n ***functional specs***\n+- :Greeter: prints hello, world.\n",
  diffWhere: { 4: { file: "hello.plain", line: 13 }, 5: { file: "hello.plain", line: 15 } },
  status: "succeeded",
  sequence: 1,
  queuedAt: Date.now() - 60_000,
  startedAt: Date.now() - 60_000,
  finishedAt: Date.now(),
  waitingOn: [],
  activity: [],
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  agents: [],
  transcriptLength: 0,
  specGaps: [],
  failures: [],
});

test.describe("the work view", () => {
  test("opens a pulse on what it renders, and opens that in intent", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), pulse());
    await window.getByRole("tab", { name: /^work/ }).click();
    await window.locator(".job", { hasText: "the greeting by name" }).click();
    // The panel's tabs: what it renders - intent, as the view it is read in - and its agents' conversation.
    await expect(window.locator(".transcript-tabs [role=tab]")).toHaveText(["intent", "conversation"]);
    await expect(window.locator(".pulse-spec-lines")).toContainText(":Greeter: prints hello, world.");
    await window.getByRole("button", { name: "open in intent" }).click();
    await expect(window.getByRole("tab", { name: "intent", selected: true })).toBeVisible();
    await expect(window.locator(".editor-pane .pane-header")).toContainText("hello.plain");
  });
});
