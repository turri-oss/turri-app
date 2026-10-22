import type { Page } from "@playwright/test";
import { expect, test } from "./app.ts";

/** An edge dragged to `x`, from where it is. */
async function drag(window: Page, edge: string, x: number) {
  const box = (await window.getByRole("separator", { name: edge }).boundingBox())!;
  await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await window.mouse.down();
  await window.mouse.move(x, box.y + box.height / 2, { steps: 5 });
  await window.mouse.up();
}

const width = async (window: Page, selector: string) => (await window.locator(selector).boundingBox())!.width;

test.describe("the layout", () => {
  test("puts the chat at the left, the views in the middle and the files at the right", async ({ launched: { window } }) => {
    await window.setViewportSize({ width: 1400, height: 800 });
    await expect(window.locator(".sidebar")).toBeVisible();
    const left = async (selector: string) => Math.round((await window.locator(selector).boundingBox())!.x);
    expect(await left(".chat")).toBe(0);
    expect(await left(".main")).toBe(400);
    expect(await left(".sidebar")).toBe(1400 - 260);
  });

  test("makes the files wider and thinner by their left edge, the chat by its right, and keeps the ***plain its room", async ({ launched: { window } }) => {
    await window.setViewportSize({ width: 1400, height: 800 });
    await expect(window.locator(".sidebar")).toBeVisible();
    expect(await width(window, ".sidebar")).toBe(260);

    // Wider, and thinner - no thinner than 180.
    await drag(window, "resize the files", 1400 - 360);
    expect(await width(window, ".sidebar")).toBe(360);
    await drag(window, "resize the files", 1400 - 40);
    expect(await width(window, ".sidebar")).toBe(180);
    await drag(window, "resize the chat", 500);
    expect(await width(window, ".chat")).toBe(500);

    // However wide either is dragged, the ***plain keeps its 480 between them.
    await drag(window, "resize the files", 0);
    await drag(window, "resize the chat", 1400);
    expect(await width(window, ".editor-pane")).toBeGreaterThanOrEqual(480);

    // A double-click is the width it starts at; and the width dragged is kept, the window reloaded.
    await window.getByRole("separator", { name: "resize the files" }).dblclick();
    expect(await width(window, ".sidebar")).toBe(260);
    await drag(window, "resize the files", 1400 - 320);
    await window.reload();
    await expect(window.locator(".sidebar")).toBeVisible();
    expect(await width(window, ".sidebar")).toBe(320);
  });
});
