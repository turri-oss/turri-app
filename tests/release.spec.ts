import { expect, test } from "./app.ts";

// turri releases after a pulse on its own (release-after-pulse) and the sentinel tries what it released - or, with
// none, the chat opens it: the window has no Release of its own, and turri is told what to do once something is released.
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

  test("is turri's, which is told to open what it released in the preview and say what to test - after a pulse, the sentinel's", async () => {
    // The engine's own JavaScript, untyped: what turri is told of the window.
    const engine: string = "../engine/app.mjs";
    const { APP_SURFACE, SENTINEL } = (await import(engine)) as { APP_SURFACE: string; SENTINEL: boolean };
    expect(APP_SURFACE).not.toMatch(/the toolbar:[^\n]*Release/i);
    expect(APP_SURFACE).toContain("release-after-pulse");
    if (SENTINEL) {
      // What a pulse released is the sentinel's to try: the chat opens a release only when asked - or with no sentinel.
      expect(APP_SURFACE).toMatch(/What a pulse released is the sentinel's to try: after a pulse you do not open it or say what to test/);
      expect(APP_SURFACE).toMatch(/When the person asks you to release something, or to try it, open it in the preview where they can watch/);
      expect(APP_SURFACE).toMatch(/With sentinel: false[^]*after a pulse too, open what it\s+released and tell them what to test/);
      expect(APP_SURFACE).not.toMatch(/Once something is released - after a pulse/);
    } else {
      expect(APP_SURFACE).toMatch(/Once something is released[^]*open it in the preview where the\s+person can watch/);
      expect(APP_SURFACE).toMatch(/what to test: what was built from the \*\*\*plain/);
      expect(APP_SURFACE).not.toMatch(/sentinel/);
    }
  });
});
