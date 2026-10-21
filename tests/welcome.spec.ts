import { expect, test } from "./app.ts";

test.describe("the welcome screen", () => {
  test.use({ open: false, recent: true });

  test("lists a recent project and opens it", async ({ launched: { window, project } }) => {
    await expect(window.getByRole("button", { name: "start a new project…" })).toBeVisible();
    await expect(window.getByRole("button", { name: "open a project…" })).toBeVisible();
    const recent = window.locator(".recents button", { hasText: "hello" });
    await expect(recent.locator(".recent-name")).toHaveText("hello");

    await recent.click();
    await expect(window.locator(".editor-pane .pane-header")).toContainText("hello.plain");
    await expect(window.locator(".editor textarea")).toHaveValue(/:Greeter: prints "hello, world"/);
    // What the project opened is listed as the most recent.
    await expect(window.locator(".welcome")).toHaveCount(0);
    expect(project).toMatch(/hello$/);
  });

  test("says which turri it runs", async ({ launched: { window } }) => {
    await expect(window.locator(".welcome-card")).toContainText(/turri \d+\.\d+\.\d+|turri local/);
  });

  test("has the Window menu at the right, before Help, as every Mac app does", async ({ launched: { app } }) => {
    const menus = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map((item) => item.label));
    expect(menus.slice(-3)).toEqual(["***plain", "Window", "Help"]);
  });
});
