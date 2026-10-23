import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator } from "@playwright/test";
import { expect, offers, tellChat, test } from "./app.ts";

/** A pulse as the engine sends it, done: it rendered one line of hello.plain, its functional specs' second. */
const pulse = () => ({
  id: "p1",
  kind: "regenerate",
  summary: "hello: the greeting by name",
  module: "hello",
  pulse: 1,
  title: "the greeting by name",
  diff: "diff --git a/hello.plain b/hello.plain\n--- a/hello.plain\n+++ b/hello.plain\n@@ -13,1 +13,2 @@\n ***functional specs***\n+- :Greeter: prints \"hello, world\" and exits with 0.\n",
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
  specGaps: [],
  failures: [],
});

/** A pulse's card opened, by its head. */
async function opened(card: Locator): Promise<Locator> {
  await card.locator(".job-head").click();
  await expect(card.locator(".job-head")).toHaveAttribute("aria-expanded", "true");
  return card;
}

test.describe("the regen view", () => {
  test("shows each pulse closed, to its head, and opens and closes it on a click", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), {
      ...pulse(),
      report: "The greeter now greets by name.",
      specGaps: [{ question: "What if no name is given?", assumption: "it greets the world" }],
    });
    await window.getByRole("tab", { name: "regen" }).click();
    const card = window.locator(".job", { hasText: "the greeting by name" });
    const head = card.locator(".job-head");
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await expect(card.locator(".pulse-spec")).toHaveCount(0);
    await expect(card.locator(".job-report")).toHaveCount(0);
    // Open: the ***plain it renders, its report and its gaps, all in view - nothing more to unfold.
    await head.click();
    await expect(card.locator(".pulse-spec-lines")).toContainText(':Greeter: prints "hello, world" and exits with 0.');
    await expect(card.locator(".job-report .prose")).toContainText("The greeter now greets by name.");
    await expect(card.locator(".gaps")).toContainText("What if no name is given?");
    // From the keyboard too, and closed again.
    await head.focus();
    await window.keyboard.press("Enter");
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await expect(card.locator(".pulse-spec")).toHaveCount(0);
  });

  test("opens a pulse clicked in the chat, in the regen view", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), pulse());
    await tellChat(app, window, "chat:message", { role: "job", id: "p1", summary: "hello: the greeting by name", status: "succeeded", duration: "1m" });
    await window.locator(".job-note-head").click();
    await expect(window.locator(".toolbar").getByRole("tab", { name: "regen", selected: true })).toBeVisible();
    const card = window.locator(".job", { hasText: "the greeting by name" });
    await expect(card.locator(".job-head")).toHaveAttribute("aria-expanded", "true");
    await expect(card.locator(".pulse-spec-lines")).toContainText("hello, world");
  });

  test("turns a spinner in the regen tab while a pulse runs", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const send = (job: object) => app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), job);
    const tab = window.locator(".toolbar").getByRole("tab", { name: /^regen/ });
    await expect(tab.locator(".spinner")).toHaveCount(0);
    await send({ ...pulse(), kind: "conformance", status: "running", finishedAt: undefined });
    await expect(tab.locator(".spinner")).toBeVisible();
    await send(pulse());
    await expect(tab.locator(".spinner")).toHaveCount(0);
  });

  test("marks the regen tab with ! when a pulse fails, and shown, opens that pulse once, in view and focused", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const send = (job: object) => app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), job);
    const tab = window.locator(".toolbar").getByRole("tab", { name: /^regen/ });
    await send({ ...pulse(), status: "running", finishedAt: undefined });
    await send({ ...pulse(), id: "p2", title: "a later one", summary: "hello: a later one", sequence: 2, queuedAt: Date.now() });
    await expect(tab.locator(".tab-failed")).toHaveCount(0);
    await send({ ...pulse(), status: "failed", error: "the tests failed" });
    await expect(tab.locator(".tab-failed")).toHaveText("!");
    await tab.click();
    await expect(tab.locator(".tab-failed")).toHaveCount(0);
    const card = window.locator(".job", { hasText: "the greeting by name" });
    await expect(card.locator(".job-head")).toHaveAttribute("aria-expanded", "true");
    await expect(card.locator(".job-head")).toBeFocused();
    await expect(window.locator(".job", { hasText: "a later one" }).locator(".job-head")).toHaveAttribute("aria-expanded", "false");
    // Once: closed, and regen shown again, it stays closed.
    await card.locator(".job-head").click();
    await window.locator(".toolbar").getByRole("tab", { name: "***plain" }).click();
    await tab.click();
    await expect(card.locator(".job-head")).toHaveAttribute("aria-expanded", "false");
    // A pulse failing while regen is shown: it is in view, so the tab is not marked.
    await send({ ...pulse(), id: "p3", title: "a third one", summary: "hello: a third one", status: "failed", sequence: 3, queuedAt: Date.now() });
    await expect(window.locator(".job", { hasText: "a third one" })).toBeVisible();
    await expect(tab.locator(".tab-failed")).toHaveCount(0);
  });

  test("lists every pulse the newest first - this session's queued, running and done, and each earlier run and its pulses", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const send = (channel: string, data: unknown) => app.evaluate(({ BrowserWindow }, [channel, data]) => BrowserWindow.getAllWindows()[0]!.webContents.send(channel as string, data), [channel, data] as const);
    const now = Date.now();
    // Sent oldest first; the last two from an engine started again, numbered from 1 again.
    await send("engine:job", { ...pulse(), id: "a", title: "first done", sequence: 1, queuedAt: now - 50_000 });
    await send("engine:job", { ...pulse(), id: "b", title: "second done", sequence: 2, queuedAt: now - 40_000 });
    await send("engine:job", { ...pulse(), id: "c", title: "third running", status: "running", finishedAt: undefined, sequence: 1, queuedAt: now - 30_000 });
    await send("engine:job", { ...pulse(), id: "d", title: "fourth queued", status: "queued", startedAt: undefined, finishedAt: undefined, sequence: 2, queuedAt: now - 20_000 });
    // The ledger's runs and their pulses oldest first, as a turri may give them.
    const past = (id: string, title: string, minutes: number) => ({ id, run: "r", kind: "regenerate", summary: title, module: "hello", pulse: 1, title, status: "succeeded", landed: true, stoppedBy: null, ms: 1000, usage: null, error: null, failures: [], queued: new Date(now - minutes * 60_000).toISOString() });
    const run = (id: string, minutes: number, pulses: unknown[]) => ({ run: id, mode: "host", started: new Date(now - minutes * 60_000).toISOString(), version: "0.1.18", pulses });
    await send("engine:earlier", [run("r1", 300, [past("o1", "older run first", 299), past("o2", "older run second", 298)]), run("r2", 120, [past("n1", "newer run first", 119), past("n2", "newer run second", 118)])]);
    await window.getByRole("tab", { name: "regen" }).click();
    await expect(window.locator(".job:not(.past) .job-title strong")).toHaveText(["fourth queued", "third running", "second done", "first done"]);
    await expect(window.locator(".job.past .job-title strong")).toHaveText(["newer run second", "newer run first", "older run second", "older run first"]);
  });

  test("shows what a pulse renders in its card, and opens that in the ***plain view", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), pulse());
    await window.getByRole("tab", { name: "regen" }).click();
    // In the card itself, nothing to open: no panel beside it, and no conversation.
    const card = await opened(window.locator(".job", { hasText: "the greeting by name" }));
    await expect(card.locator(".pulse-spec-lines")).toContainText(':Greeter: prints "hello, world" and exits with 0.');
    // In the card's right half, beside what the pulse is and did.
    const main = (await card.locator(".job-main").boundingBox())!;
    const plain = (await card.locator(".pulse-spec").boundingBox())!;
    const whole = (await card.boundingBox())!;
    expect(plain.x).toBeGreaterThan(main.x + main.width);
    expect(plain.x).toBeGreaterThanOrEqual(whole.x + whole.width / 2 - 20);
    await card.locator(".job-body").click({ position: { x: 4, y: 4 } });
    await expect(window.locator(".transcript")).toHaveCount(0);
    await expect(window.getByRole("tab", { name: "conversation" })).toHaveCount(0);
    await card.getByRole("button", { name: "open", exact: true }).click();
    await expect(window.locator(".toolbar").getByRole("tab", { name: "***plain", selected: true })).toBeVisible();
    await expect(window.locator(".editor-pane .pane-header")).toContainText("hello.plain");
  });

  test("offers to open a pulse's lines in the ***plain only while they are still there", async ({ launched: { app, window, project } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), pulse());
    // A pulse on a ***plain file that is no longer the project's: nothing to open.
    const gone = pulse();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), {
      ...gone,
      id: "p2",
      summary: "gone: a file since removed",
      title: "a file since removed",
      diff: gone.diff.replaceAll("hello.plain", "gone.plain"),
      diffWhere: { 4: { file: "gone.plain", line: 13 }, 5: { file: "gone.plain", line: 15 } },
    });
    await window.getByRole("tab", { name: "regen" }).click();
    const card = await opened(window.locator(".job", { hasText: "the greeting by name" }));
    const open = card.getByRole("button", { name: "open", exact: true });
    await expect(open).toBeVisible();
    const removed = await opened(window.locator(".job", { hasText: "a file since removed" }));
    await expect(removed.locator(".pulse-spec-lines")).toContainText("hello, world");
    await expect(removed.getByRole("button", { name: "open", exact: true })).toHaveCount(0);
    // Its line edited away since: the button goes.
    const file = join(project, "hello.plain");
    writeFileSync(file, readFileSync(file, "utf8").replace('prints "hello, world" and exits with 0.', "prints a greeting."));
    await expect(open).toHaveCount(0);
  });

  test("stops the pulses that were running once the engine stops", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const send = (channel: string, data: unknown) => app.evaluate(({ BrowserWindow }, [channel, data]) => BrowserWindow.getAllWindows()[0]!.webContents.send(channel as string, data), [channel, data] as const);
    await send("engine:job", { ...pulse(), status: "running", finishedAt: undefined });
    await window.getByRole("tab", { name: "regen" }).click();
    const card = window.locator(".job", { hasText: "the greeting by name" });
    await expect(card).toHaveClass(/\brunning\b/);
    await send("engine:exit", { code: 1 });
    await expect(card).toHaveClass(/\bstopped\b/);
    await opened(card);
    await expect(card.locator(".job-report .prose")).toContainText("The turri engine stopped under this pulse.");
  });

  test("keeps a long ***plain change within a ceiling, to scroll", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const added = Array.from({ length: 80 }, (_, at) => `+- :Greeter: greets visitor ${at + 1}.`);
    const diff = `diff --git a/hello.plain b/hello.plain\n--- a/hello.plain\n+++ b/hello.plain\n@@ -13,1 +13,${added.length + 1} @@\n ***functional specs***\n${added.join("\n")}\n`;
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), { ...pulse(), diff, diffWhere: {} });
    await window.getByRole("tab", { name: "regen" }).click();
    const lines = (await opened(window.locator(".job", { hasText: "the greeting by name" }))).locator(".pulse-spec-lines");
    await expect(lines).toContainText("greets visitor 80.");
    const box = await lines.evaluate((element) => ({ height: element.clientHeight, content: element.scrollHeight, overflow: getComputedStyle(element).overflowY }));
    expect(box.height).toBeLessThanOrEqual(220);
    expect(box.content).toBeGreaterThan(box.height);
    expect(box.overflow).toBe("auto");
    await lines.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect.poll(() => lines.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  });

  test("goes along the views with ctrl+tab and ctrl+shift+tab while the focus is in them, and the chats while it is in the chat", async ({ launched: { window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const tab = (name: string) => window.locator(".toolbar").getByRole("tab", { name, exact: true });
    await window.locator(".editor-pane textarea").first().click();
    await window.keyboard.press("Control+Tab");
    await expect(tab("regen")).toHaveAttribute("aria-selected", "true");
    await window.keyboard.press("Control+Tab");
    await expect(tab("preview")).toHaveAttribute("aria-selected", "true");
    // Round from the ends.
    await window.keyboard.press("Control+Tab");
    await expect(tab("***plain")).toHaveAttribute("aria-selected", "true");
    await window.keyboard.press("Control+Shift+Tab");
    await expect(tab("preview")).toHaveAttribute("aria-selected", "true");
    // In the chat, ctrl+tab is the chats': the view stays.
    await window.locator(".composer textarea").click();
    await window.keyboard.press("Control+Tab");
    await expect(tab("preview")).toHaveAttribute("aria-selected", "true");
  });

  test("moves the focus to the chat with ⌥⌘← and to the view shown with ⌥⌘→", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), pulse());
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    const box = window.locator(".composer textarea");
    await box.click();
    await window.keyboard.press(`${mod}+Alt+ArrowRight`);
    await expect(window.locator(".editor-pane textarea").first()).toBeFocused();
    // From there, ctrl+tab is the views'.
    await window.keyboard.press("Control+Tab");
    await expect(window.locator(".toolbar").getByRole("tab", { name: "regen", exact: true })).toHaveAttribute("aria-selected", "true");
    await window.keyboard.press(`${mod}+Alt+ArrowLeft`);
    await expect(box).toBeFocused();
    await window.keyboard.press(`${mod}+Alt+ArrowRight`);
    await expect(window.locator(".work-view")).toBeFocused();
  });

  test("says a codebase is built from ***plain as it is, never the spec", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const status = { modules: [{ module: "hello", plainFile: "hello.plain", planned: [], why: "built from the spec as it is" }], jobs: [] };
    await app.evaluate(({ BrowserWindow }, data) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:status", data), status);
    await window.getByRole("tab", { name: "regen" }).click();
    const head = window.locator(".module-plan-head", { hasText: "hello" });
    await expect(head).toContainText("built from");
    await expect(head).not.toContainText("from the");
    await expect(head).toContainText("plain as it is");
    await expect(head).not.toContainText("spec");
  });

  test("keeps a failed pulse's long diagnosis within a ceiling, to scroll", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const diagnosis = Array.from({ length: 60 }, (_, at) => `Cause ${at + 1}: the greeter was not found.`).join("\n");
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), { ...pulse(), status: "failed", diagnosis });
    await window.getByRole("tab", { name: "regen" }).click();
    // Failed while regen was not shown: shown, it is open already.
    const text = window.locator(".job", { hasText: "the greeting by name" }).locator(".diagnosis > div");
    await expect(text).toContainText("Cause 60");
    const box = await text.evaluate((element) => ({ height: element.clientHeight, content: element.scrollHeight, overflow: getComputedStyle(element).overflowY }));
    expect(box.height).toBeLessThanOrEqual(220);
    expect(box.content).toBeGreaterThan(box.height);
    expect(box.overflow).toBe("auto");
  });

  test("keeps a long report within a ceiling, to scroll", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const report = Array.from({ length: 60 }, (_, at) => `Step ${at + 1}: the greeting was checked again.`).join("\n\n");
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), { ...pulse(), report });
    await window.getByRole("tab", { name: "regen" }).click();
    const card = await opened(window.locator(".job", { hasText: "the greeting by name" }));
    const prose = card.locator(".job-report .prose");
    await expect(prose).toContainText("Step 60:");
    const box = await prose.evaluate((element) => ({ height: element.clientHeight, content: element.scrollHeight, overflow: getComputedStyle(element).overflowY }));
    expect(box.height).toBeLessThanOrEqual(220);
    expect(box.content).toBeGreaterThan(box.height);
    expect(box.overflow).toBe("auto");
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
    await window.getByRole("tab", { name: "regen" }).click();
    const card = await opened(window.locator(".job", { hasText: "create and list" }));

    // Two functional specs, and the blank lines turri's diff leaves out - after the section's header, and between them -
    // drawn, numbered.
    const panel = card.locator(".pulse-spec-lines > div");
    await expect(panel.nth(1)).toHaveText("14​");
    await expect(panel.nth(4)).toHaveText("17​");
    await expect(panel.nth(5)).toContainText("lists their :Repo: items");

    // Both lit in the ***plain view, where they are now - not where they were.
    await card.getByRole("button", { name: "open", exact: true }).click();
    const line = (index: number) => window.locator(`.editor-colours [data-line="${index}"]`);
    await expect(line(16)).toHaveClass(/rendering/);
    await expect(line(19)).toHaveClass(/rendering/);
    await expect(line(12)).not.toHaveClass(/rendering/);
    await expect(line(14)).not.toHaveClass(/rendering/);

    // Lit once: back to work and to the ***plain view again, nothing is.
    await window.getByRole("tab", { name: "regen" }).click();
    await window.locator(".toolbar").getByRole("tab", { name: "***plain" }).click();
    await expect(window.locator(".editor-pane .pane-header")).toContainText("repos.plain");
    await expect(line(16)).toBeVisible();
    // Looked at once, a moment in: lines lit again would stay so for seconds, and a retrying expect would wait them out.
    await window.waitForTimeout(600);
    expect(await window.locator(".editor-colours .rendering").count()).toBe(0);
  });

  test("keeps what a running pulse renders lit in the ***plain view as a functional spec is added above it", async ({ launched: { app, window, spec } }) => {
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

  test("shows an earlier session's pulse with nothing more to it as a card that does not open", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const run = {
      run: "r1",
      mode: "host",
      started: new Date(Date.now() - 3_600_000).toISOString(),
      version: "0.1.15",
      pulses: [{ id: "old1", run: "r1", kind: "regenerate", summary: "hello: the root endpoint", module: "hello", pulse: 1, title: "the root endpoint", status: "succeeded", landed: true, stoppedBy: null, ms: 97_000, usage: null, error: null, failures: [] }],
    };
    await app.evaluate(({ BrowserWindow }, runs) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:earlier", runs), [run]);
    await window.getByRole("tab", { name: "regen" }).click();
    const card = window.locator(".job.past", { hasText: "the root endpoint" });
    await expect(card).toContainText("succeeded, landed");
    // What the ledger says of it is not the window's to show, and no ***plain kept of it: a click opens nothing.
    await expect(card.locator(".job-head")).not.toHaveAttribute("role", "button");
    await card.click();
    await expect(card).not.toContainText("from the ledger");
    await expect(card.locator(".job-body")).toHaveCount(0);
  });

  test("shows the ***plain an earlier session's pulse regenerated, as the ledger keeps it, and opens it", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    const { diff, diffWhere } = pulse();
    const run = {
      run: "r1",
      mode: "host",
      started: new Date(Date.now() - 3_600_000).toISOString(),
      version: "0.1.19",
      pulses: [{ id: "old1", run: "r1", kind: "regenerate", summary: "hello: the root endpoint", module: "hello", pulse: 1, title: "the root endpoint", status: "succeeded", landed: true, stoppedBy: null, ms: 97_000, usage: null, error: null, failures: [], diff, diffWhere }],
    };
    await app.evaluate(({ BrowserWindow }, runs) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:earlier", runs), [run]);
    await window.getByRole("tab", { name: "regen" }).click();
    const card = window.locator(".job.past", { hasText: "the root endpoint" });
    await expect(card.locator(".pulse-spec")).toHaveCount(0);
    await opened(card);
    await expect(card.locator(".pulse-spec-lines")).toContainText(':Greeter: prints "hello, world" and exits with 0.');
    const main = (await card.locator(".job-main").boundingBox())!;
    const plain = (await card.locator(".pulse-spec").boundingBox())!;
    expect(plain.x).toBeGreaterThan(main.x + main.width);
    await card.getByRole("button", { name: "open", exact: true }).click();
    await expect(window.locator(".toolbar").getByRole("tab", { name: "***plain", selected: true })).toBeVisible();
    await expect(window.locator(".editor-pane .pane-header")).toContainText("hello.plain");
  });
});

test.describe("a failed pulse", () => {
  test.use({ stubModel: "silent" });

  test("opens a closed pulse on a click anywhere on its card - but not on investigate, nor closes it from its body", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), { ...pulse(), status: "failed", error: "the tests did not pass" });
    await window.getByRole("tab", { name: "regen" }).click();
    const card = window.locator(".job", { hasText: "the greeting by name" });
    const head = card.locator(".job-head");
    // Failed while regen was not shown: showing it opens the pulse, once - closed here by its head.
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "false");
    // investigate is its own: it asks a chat, and leaves the card closed.
    await card.getByRole("button", { name: "investigate" }).click();
    await expect(head).toHaveAttribute("aria-expanded", "false");
    // The line under the head, and the card's own edge, open it.
    await card.locator(".job-outcome").click({ position: { x: 4, y: 4 } });
    await expect(head).toHaveAttribute("aria-expanded", "true");
    // Open, a click in its body leaves it open; its head closes it.
    await card.locator(".job-body").click({ position: { x: 4, y: 4 } });
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "false");
    const box = (await card.boundingBox())!;
    await window.mouse.click(box.x + box.width - 4, box.y + box.height - 3);
    await expect(head).toHaveAttribute("aria-expanded", "true");
  });

  test("offers only investigate, which asks a chat of its own why it failed", async ({ launched: { app, window, requests } }) => {
    test.skip(!(await offers(window)).chats, "the turri running has one chat");
    await expect(window.locator(".chat-model")).toBeVisible();
    // Regen shown first: a pulse failing while it is not shown is opened when it is, once.
    await window.getByRole("tab", { name: "regen" }).click();
    await app.evaluate(({ BrowserWindow }, job) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:job", job), {
      ...pulse(),
      status: "failed",
      error: "The conformance tests could not reach the greeter.",
    });
    // Closed, it says it failed, and investigate is right of that.
    const card = window.locator(".job", { hasText: "the greeting by name" });
    await expect(card.locator(".job-head")).toHaveAttribute("aria-expanded", "false");
    const outcome = card.locator(".job-outcome");
    await expect(outcome).toContainText("failed");
    const investigate = outcome.getByRole("button", { name: "investigate" });
    await expect(investigate).toBeVisible();
    const said = (await outcome.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element.firstChild!);
      const box = range.getBoundingClientRect();
      return { right: box.right, y: box.y + box.height / 2 };
    }))!;
    const button = (await investigate.boundingBox())!;
    expect(button.x).toBeGreaterThan(said.right);
    expect(Math.abs(button.y + button.height / 2 - said.y)).toBeLessThan(6);
    await expect(card.getByRole("button", { name: "why it failed" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "copy" })).toHaveCount(0);
    await card.getByRole("button", { name: "investigate" }).click();
    const tabs = window.locator(".chat-tabs [role=tab]");
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => requests.at(-1) ?? "").toContain("Investigate the pulse that failed (hello · pulse 1 · regenerate · p1)");
    expect(requests.at(-1)).toContain("The conformance tests could not reach the greeter.");
  });
});
