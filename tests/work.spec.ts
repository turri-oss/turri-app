import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

  test("finds a pulse's lines where they are now, and shows the blank line between two of its functional specs", async ({ launched: { app, window, project } }) => {
    // Since the pulse ran, a definition was added above what it rendered: its lines are two further down now.
    writeFileSync(
      join(project, "repos.plain"),
      "---\ndescription: Repos.\n---\n\n***definitions***\n\n- :Repo: is a store.\n\n- :Owner: is who owns a :Repo:.\n\n***implementation reqs***\n\n- :Implementation: is in Java.\n\n***functional specs***\n\n- An :Owner: creates a :Repo:.\n  - A missing token returns `401`.\n\n- An :Owner: lists their :Repo: items.\n  - A missing token returns `401`.\n",
    );
    await expect(window.locator(".tree-row", { hasText: "repos.plain" })).toBeVisible();
    const diff = [
      "diff --git a/repos.plain b/repos.plain",
      "--- a/repos.plain",
      "+++ b/repos.plain",
      "@@ @@",
      " ***functional specs***",
      "+- An :Owner: creates a :Repo:.",
      "+  - A missing token returns `401`.",
      "+- An :Owner: lists their :Repo: items.",
      "+  - A missing token returns `401`.",
    ].join("\n");
    const where = Object.fromEntries([13, 15, 16, 18, 19].map((line, at) => [at + 4, { file: "repos.plain", line }]));
    const job = { ...pulse(), id: "p2", module: "repos", summary: "repos: create and list", title: "create and list", diff, diffWhere: where };
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), job);
    await window.getByRole("tab", { name: /^work/ }).click();
    await window.locator(".job", { hasText: "create and list" }).click();

    // Two functional specs, and the blank lines turri's diff leaves out - after the section's header, and between them -
    // drawn, numbered.
    const panel = window.locator(".pulse-spec-lines > div");
    await expect(panel.nth(1)).toHaveText("14​");
    await expect(panel.nth(4)).toHaveText("17​");
    await expect(panel.nth(5)).toContainText("lists their :Repo: items");

    // Both lit in intent, where they are now - not where they were.
    await window.getByRole("button", { name: "open in intent" }).click();
    const line = (index: number) => window.locator(`.editor-colours [data-line="${index}"]`);
    await expect(line(16)).toHaveClass(/rendering/);
    await expect(line(19)).toHaveClass(/rendering/);
    await expect(line(12)).not.toHaveClass(/rendering/);
    await expect(line(14)).not.toHaveClass(/rendering/);

    // Lit once: back to work and to intent again, nothing is.
    await window.getByRole("tab", { name: /^work/ }).click();
    await window.getByRole("tab", { name: "intent" }).click();
    await expect(window.locator(".editor-pane .pane-header")).toContainText("repos.plain");
    await expect(line(16)).toBeVisible();
    // Looked at once, a moment in: lines lit again would stay so for seconds, and a retrying expect would wait them out.
    await window.waitForTimeout(600);
    expect(await window.locator(".editor-colours .rendering").count()).toBe(0);
  });

  test("keeps what a running pulse renders lit in intent as a functional spec is added above it", async ({ launched: { app, window, spec } }) => {
    // Running: it renders hello.plain's functional spec, line 15 when it started.
    const diff = ["diff --git a/hello.plain b/hello.plain", "--- a/hello.plain", "+++ b/hello.plain", "@@ @@", " ***functional specs***", '+- :Greeter: prints "hello, world" and exits with 0.'].join("\n");
    const running = { ...pulse(), id: "p3", status: "running", finishedAt: undefined, diff, diffWhere: { 4: { file: "hello.plain", line: 13 }, 5: { file: "hello.plain", line: 15 } } };
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), running);
    const line = (index: number) => window.locator(`.editor-colours [data-line="${index}"]`);
    await expect(line(14)).toHaveClass(/rendering/);

    // A functional spec written in above it, as turri or the chat would: it moves down two lines, and stays lit there.
    writeFileSync(spec, readFileSync(spec, "utf8").replace("- :Greeter: prints", "- :Greeter: waves first.\n\n- :Greeter: prints"));
    await expect(line(16)).toContainText("prints");
    await expect(line(16)).toHaveClass(/rendering/);
    await expect(line(14)).not.toHaveClass(/rendering/);
  });
});
