import { expect, test } from "./app.ts";

// turri releases after a pulse on its own (release-after-pulse) and the chat opens what it released: the window has
// no Release of its own, and turri is told what to do once something is released.
test.describe("releasing", () => {
  test("has no button or menu item of the window's", async ({ launched: { app, window } }) => {
    await expect(window.locator(".toolbar-actions")).toBeVisible();
    await expect(window.locator(".toolbar-actions").getByRole("button", { name: /release/i })).toHaveCount(0);
    const labels = await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.flatMap((item) => [item.label, ...(item.submenu?.items.map((sub) => sub.label) ?? [])]),
    );
    expect(labels).toContain("Regenerate…");
    expect(labels.filter((label) => /release/i.test(label))).toEqual([]);
  });

  test("is turri's, which is told to open what it released in the preview and say what to test", async () => {
    // The engine's own JavaScript, untyped: what turri is told of the window.
    const engine: string = "../engine/app.mjs";
    const { APP_SURFACE } = (await import(engine)) as { APP_SURFACE: string };
    expect(APP_SURFACE).not.toMatch(/the toolbar:[^\n]*Release/i);
    expect(APP_SURFACE).toContain("release-after-pulse");
    expect(APP_SURFACE).toMatch(/Once something is released[^]*open it in the preview where the\s+person can watch/);
    expect(APP_SURFACE).toMatch(/what to test: what was built from the \*\*\*plain/);
  });
});
