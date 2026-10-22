import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "./app.ts";

// turri's browser and terminal tools bring the window to the one they use ("preview:reveal", "terminal:reveal"): sent
// here as they would be.
test.describe("the preview", () => {
  test("opens on neither, then on each as it is used, with a switch once both are", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await window.getByRole("tab", { name: "preview" }).click();
    await expect(window.locator(".preview .empty h3")).toHaveText("nothing to try yet");
    await expect(window.locator(".preview-bar")).toHaveCount(0);

    const reveal = (channel: string) => app.evaluate(({ BrowserWindow }, channel) => BrowserWindow.getAllWindows()[0]!.webContents.send(channel, null), channel);
    await reveal("terminal:reveal");
    await expect(window.locator(".preview-terminal")).toHaveCount(1);
    await expect(window.locator(".preview-bar .segmented")).toHaveCount(0);

    await reveal("preview:reveal");
    await expect(window.locator(".preview-address")).toHaveCount(1);
    await window.getByRole("tab", { name: "terminal" }).click();
    await expect(window.locator(".preview-terminal")).toHaveCount(1);
    await window.getByRole("tab", { name: "browser" }).click();
    await expect(window.locator(".preview-address")).toHaveCount(1);
  });
});

// The main process says turri is testing while its browser or terminal tools run ("preview:testing"): sent here as it
// would be, as no test has a model call them.
test.describe("the preview, while turri tests in it", () => {
  let server: Server;
  let address: string;
  test.beforeAll(async () => {
    server = createServer((_request, response) => response.end("<!doctype html><title>hello</title><p>hello"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    address = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  test.afterAll(() => server.close());

  test("edges the browser in blue, draws the page inside the edge, and says so in its bar", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await window.getByRole("tab", { name: "preview" }).click();
    await window.getByRole("button", { name: "open a browser" }).click();
    await window.locator(".preview-address input").fill(address);
    await window.locator(".preview-address input").press("Enter");
    const page = window.locator(".preview-page");
    const bounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children[0]?.getBounds());
    const box = (await page.boundingBox())!;
    await expect.poll(async () => (await bounds())?.width).toBe(Math.round(box.width));

    const testing = (now: boolean) => app.evaluate(({ BrowserWindow }, now) => BrowserWindow.getAllWindows()[0]!.webContents.send("preview:testing", now), now);
    await testing(true);
    await expect(window.locator(".preview-bar .preview-testing")).toHaveText("turri is testing");
    await expect(window.locator(".preview.testing")).toHaveCount(1);
    await expect.poll(async () => (await bounds())?.width).toBe(Math.round(box.width) - 6);
    expect(await page.evaluate((element) => getComputedStyle(element, "::after").borderTopWidth)).toBe("3px");

    await testing(false);
    await expect(window.locator(".preview-testing")).toHaveCount(0);
    await expect.poll(async () => (await bounds())?.width).toBe(Math.round(box.width));
  });

  test("edges the terminal too", async ({ launched: { app, window } }) => {
    await expect(window.locator(".chat-model")).toBeVisible();
    await window.getByRole("tab", { name: "preview" }).click();
    await window.getByRole("button", { name: "open a terminal" }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send("preview:testing", true));
    await expect(window.locator(".preview-bar .preview-testing")).toHaveText("turri is testing");
    await expect(window.locator(".preview.testing .preview-terminal")).toHaveCount(1);
  });
});
