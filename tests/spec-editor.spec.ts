import { readFileSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./app.ts";
import { keys } from "./keys.ts";

/** A functional spec's mark in the gutter, by its number. */
const mark = (window: Page, frid: number) => window.locator(`.editor-colours .mark[aria-label^="functional spec ${frid},"]`);

test.describe("the spec editor", () => {
  test("shows the spec, coloured by turri's grammar, with its functional spec marked", async ({ launched: { window } }) => {
    await expect(window.locator(".editor-pane .pane-header")).toContainText("0 of 1 built");
    await expect(window.locator(".editor-colours .plain-concept").first()).toBeVisible();
    // In the coloured layer, which is hidden from the accessibility tree: the textarea over it reads the spec.
    await expect(mark(window, 1)).toHaveAttribute("aria-label", "functional spec 1, to build");
  });

  test("keeps its two layers alike, so the caret is on the line it shows", async ({ launched: { window } }) => {
    const area = window.locator(".editor textarea");
    await expect(area).toHaveValue(/Greeter/);
    // A line long enough to wrap: both layers must wrap it at the same place.
    await area.click();
    await window.keyboard.press(`${keys.mod}+End`);
    await window.keyboard.type(`\n- :Greeter: ${"says hello again and again, ".repeat(12)}then stops.`);

    const layers = await window.evaluate(() => {
      const area = document.querySelector<HTMLTextAreaElement>(".editor textarea")!;
      const pre = document.querySelector<HTMLPreElement>(".editor-colours")!;
      const of = (element: HTMLElement) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          width: box.width,
          font: `${style.fontFamily} ${style.fontSize} ${style.fontWeight} ${style.lineHeight} ${style.letterSpacing}`,
          padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
          wrap: `${style.whiteSpace} ${style.overflowWrap} ${style.wordBreak} ${style.tabSize}`,
        };
      };
      return { area: of(area), pre: of(pre), coloured: pre.offsetHeight, height: area.clientHeight, scroll: area.scrollHeight };
    });
    expect(layers.area).toEqual(layers.pre);
    // The textarea is as tall as the coloured text - or the editor, when that is taller - and scrolls nothing inside
    // itself, out of step with the other layer.
    expect(layers.height).toBeGreaterThanOrEqual(layers.coloured);
    expect(layers.scroll).toBeLessThanOrEqual(layers.height);
  });

  test("saves an edit to the file", async ({ launched: { window, spec } }) => {
    const area = window.locator(".editor textarea");
    await expect(area).toHaveValue(/Greeter/);
    await expect(window.locator(".pane-header-right")).toContainText("saved");

    await area.click();
    await window.keyboard.press(`${keys.mod}+End`);
    await window.keyboard.type("\n- :Greeter: says goodbye when interrupted.");
    await expect(window.getByRole("button", { name: /^save/ })).toBeVisible();
    await expect(mark(window, 2)).toBeVisible();

    await window.keyboard.press(`${keys.mod}+s`);
    await expect(window.locator(".pane-header-right")).toContainText("saved");
    expect(readFileSync(spec, "utf8")).toContain("- :Greeter: says goodbye when interrupted.");
  });

  test("shows a change made on disk", async ({ launched: { window, spec } }) => {
    const area = window.locator(".editor textarea");
    await expect(area).toHaveValue(/Greeter/);
    writeFileSync(spec, readFileSync(spec, "utf8") + "\n- :Greeter: waves.\n");
    await expect(area).toHaveValue(/:Greeter: waves\./);
  });
});
