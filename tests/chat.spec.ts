import { expect, test } from "./app.ts";

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

  test("runs a slash command that only prints", async ({ launched: { window } }) => {
    const box = window.getByPlaceholder("talk to turri - or / for a command");
    await box.fill("/stdlib");
    await box.press("Enter");
    await expect(window.locator(".chat-body")).toContainText("The ***plain standard library");
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

  test("once hidden, is opened again by the turri button, rightmost in the toolbar", async ({ launched: { window } }) => {
    await window.locator(".chat button[title^='hide the chat']").click();
    const open = window.locator(".toolbar-actions > :last-child");
    await expect(open).toHaveText("turri");
    await expect(open.locator("img")).toHaveAttribute("src", "./jellyfish/logo-mark.svg");
    await open.click();
    await expect(window.locator(".chat-model")).toBeVisible();
  });
});
