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
});
