import { expect, offers, test } from "./app.ts";

// Only what calls no model: slash commands that print, and the window's own.
test.describe("the chat", () => {
  test("is on the project's harness-model", async ({ launched: { window } }) => {
    await expect(window.locator(".chat-model")).toHaveText("claude-sonnet-5-5");
  });

  test("suggests slash commands as one is typed", async ({ launched: { window } }) => {
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await box.fill("/std");
    await expect(window.locator(".suggestions")).toContainText("/stdlib");
  });

  test("opens a concept clicked in the chat where the ***plain defines it", async ({ launched: { app, window } }) => {
    // Where it is defined, from turri's graph: on a turri whose host entry gives it.
    test.skip(!(await offers(window)).links, "the turri running gives the window no graph of the ***plain");
    await app.evaluate(
      ({ BrowserWindow }, message) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:chat:message", message),
      { role: "assistant", text: "The :Greeter: greets whoever runs it." },
    );
    await window.getByRole("tab", { name: "work" }).click();
    await window.locator(".prose .plain-concept", { hasText: ":Greeter:" }).click();
    await expect(window.locator(".toolbar").getByRole("tab", { name: "***plain", selected: true })).toBeVisible();
    await expect(window.locator(".editor-pane .pane-header")).toContainText("hello.plain");
    // Its definition, lit: line 6 of hello.plain.
    await expect(window.locator(".editor-colours > div.rendering")).toContainText(":Greeter: is a command-line program");
  });

  test("offers the concepts the ***plain names as one is typed, and takes one", async ({ launched: { window } }) => {
    // Concepts as turri reads them: on a turri whose host entry gives them.
    test.skip(!(await offers(window)).concepts, "the turri running gives the window no concepts");
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await box.fill("what does :Gre");
    const offered = window.getByRole("listbox", { name: "concepts" });
    // The fixture's own, with what its definition says; and ***plain's own, which it does not start.
    await expect(offered.getByRole("option").first()).toContainText(":Greeter:");
    await expect(offered).toContainText("greets the person running it");
    await box.press("Tab");
    await expect(box).toHaveValue("what does :Greeter: ");
    await expect(offered).toHaveCount(0);
    // Not after a concept closed: its colon opens none.
    await box.fill("what does :Greeter:");
    await expect(offered).toHaveCount(0);
  });

  test("runs a slash command that only prints", async ({ launched: { window } }) => {
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await box.fill("/stdlib");
    await box.press("Enter");
    // ***plain written as its name is: its mark, then plain.
    await expect(window.locator(".chat-body .plain-name", { hasText: "plain" }).first()).toBeVisible();
    await expect(window.locator(".chat-body")).toContainText("The plain standard library");
    await expect(window.locator(".chat-body")).toContainText("stdlib/backend/python-fastapi");
    // Nothing went to the model: no turn started, nothing spent.
    await expect(window.locator(".chat-body .msg.assistant")).toHaveCount(0);
  });

  test("opens the sign-in sheet for /login, rather than sending it", async ({ launched: { window } }) => {
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await box.fill("/login");
    await box.press("Enter");
    await expect(window.locator(".sheet.auth h2")).toHaveText("sign in to your models");
    await expect(window.locator(".chat-body .msg.assistant")).toHaveCount(0);
  });

  test("writes ***plain as its name is, its mark then plain - but not in code", async ({ launched: { window, app } }) => {
    // The window's own words: the empty chat's.
    await expect(window.locator(".chat-empty .plain-name img.plain-mark")).toHaveAttribute("src", "./plain/plain-mark.svg");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.send("engine:chat:notify", { level: "info", text: "the \\*\\*\\*plain says so - `***plain` in code stays as it is." }),
    );
    const note = window.locator(".chat-body .msg.note", { hasText: "says so" });
    await expect(note.locator(".plain-name")).toHaveCount(1);
    await expect(note.locator("code")).toHaveText("***plain");
  });

  test("colours a ```plain block by turri's grammar", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    // As the engine says a note: what a model would write, without one.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.send("engine:chat:notify", {
        level: "info",
        text: "the change:\n\n```plain\n***definitions***\n\n- :Greeter: is a command-line program.\n```",
      }),
    );
    const block = window.locator(".chat-body pre.plain-code");
    await expect(block.locator(".plain-concept").first()).toHaveText(":Greeter:");
    await expect(block).toHaveText("***definitions***\n\n- :Greeter: is a command-line program.");
  });

  test("colours a block with no language that is ***plain, and leaves other code alone", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => {
      const say = (text: string) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:chat:notify", { level: "info", text });
      say(
        '```\n---\nimport:\n  - stdlib/backend/python-fastapi\ndescription: A small HTTP server.\n---\n\n***definitions***\n\n- :Server: is the HTTP service this module builds, named `server`.\n\n***functional specs***\n\n- :Server: answers `GET /` with `200` and the JSON body `{"name": "server"}`.\n```',
      );
      say("```\nprint('***not plain***, as no line is only a section')\n```");
    });
    await expect(window.locator(".chat-body pre.plain-code .plain-concept").first()).toHaveText(":Server:");
    await expect(window.locator(".chat-body pre.plain-code .plain-section").first()).toHaveText("***definitions***");
    await expect(window.locator(".chat-body pre.plain-code")).toHaveCount(1);
  });

  test("colours a diff, and the ***plain in a diff of ***plain", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => {
      const say = (text: string) => BrowserWindow.getAllWindows()[0]!.webContents.send("engine:chat:notify", { level: "info", text });
      say("```diff\n--- a/hello.plain\n+++ b/hello.plain\n@@ -1,2 +1,2 @@\n ***definitions***\n-- :Greeter: greets.\n+- :Greeter: greets the person.\n```");
      say("```diff\n--- a/main.py\n+++ b/main.py\n@@ -1 +1 @@\n-print('hi')\n+print('hello, world')\n```");
    });
    const [plain, code] = [window.locator(".chat-body pre.diff").first(), window.locator(".chat-body pre.diff").nth(1)];
    await expect(plain.locator(".line.add .plain-concept")).toHaveText(":Greeter:");
    await expect(plain.locator(".line.del")).toHaveText("-- :Greeter: greets.");
    await expect(plain.locator(".line.hunk")).toHaveText("@@ -1,2 +1,2 @@");
    await expect(code.locator(".line.add")).toHaveText("+print('hello, world')");
    await expect(code.locator("[class^='plain-']")).toHaveCount(0);
  });

  test("once hidden, is opened again by the turri button, leftmost in the toolbar", async ({ launched: { window } }) => {
    await window.locator(".chat button[title^='hide the chat']").click();
    const open = window.locator(".toolbar > :first-child");
    await expect(open).toHaveText("turri");
    await expect(open.locator("img")).toHaveAttribute("src", "./jellyfish/logo-mark.svg");
    await open.click();
    await expect(window.locator(".chat-model")).toBeVisible();
  });
});
