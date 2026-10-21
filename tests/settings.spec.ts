import type { ElectronApplication, Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./app.ts";

/** A menu item chosen: the window in front is sent its action, as the native menu sends it - once it is drawn, to hear it. */
async function choose(app: ElectronApplication, page: Page, action: string) {
  await expect(page.locator(".welcome, .app").first()).toBeVisible();
  await app.evaluate(({ BrowserWindow }, action) => BrowserWindow.getAllWindows()[0]!.webContents.send("menu", action), action);
}

test.describe("first run", () => {
  test.use({ open: false, recent: false });

  test("leads the way from the machine to a first project", async ({ launched: { window: page } }) => {
    const steps = page.getByRole("list", { name: "getting started" });
    await expect(steps).toBeVisible();
    await expect(steps.locator("> li")).toHaveCount(3);
    // The test's ANTHROPIC_API_KEY is a provider turri can reach.
    await expect(steps.locator("> li", { hasText: "turri can reach a model" })).toHaveClass(/done/);
    await expect(steps).toContainText("start your first project");
  });
});

test.describe("settings", () => {
  test.use({ open: false, recent: true });

  test("change the look and the models new projects start on, and keep them", async ({ launched: { app, window: page } }) => {
    await choose(app, page, "settings");
    const sheet = page.getByRole("dialog", { name: "settings" });
    await sheet.getByRole("button", { name: "light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    const vendor = sheet.getByRole("combobox", { name: "the models new projects start on" });
    const first = await vendor.locator("option").nth(1).getAttribute("value");
    await vendor.selectOption(first!);
    await sheet.getByRole("switch", { name: "pre-releases too" }).click();
    const saved = await page.evaluate(() => window.turri.settings.get());
    expect(saved).toMatchObject({ theme: "light", vendor: first, prerelease: true, checkUpdates: true });
    // Run from source, the app does not update itself: the sheet says so.
    await expect(sheet).toContainText("cannot update itself here");
  });

  test("refuses a setting there is not", async ({ launched: { window: page } }) => {
    const saved = await page.evaluate(() => window.turri.settings.set({ theme: "purple", zoom: "big", nonsense: 1 } as never));
    expect(saved.theme).toBe("dark");
    expect(saved.zoom).toBe(0);
    expect(saved).not.toHaveProperty("nonsense");
  });
});

test.describe("about", () => {
  test.use({ open: false, recent: true });

  test("says what the app is made of, what it sends, and its third-party notices", async ({ launched: { app, window: page } }) => {
    await choose(app, page, "about");
    const sheet = page.getByRole("dialog", { name: "about turri" });
    await expect(sheet.locator(".about-versions")).toContainText("Electron");
    await sheet.getByRole("tab", { name: "privacy" }).click();
    await expect(sheet).toContainText("the app collects no telemetry");
    await sheet.getByRole("tab", { name: "third-party notices" }).click();
    await sheet.getByRole("searchbox").fill("react-dom");
    const row = sheet.locator(".notice-row", { hasText: "react-dom" });
    await expect(row).toContainText("MIT");
    await row.click();
    await expect(sheet.locator(".notice-text pre")).toContainText("Permission is hereby granted");
    await sheet.getByRole("searchbox").fill("zed mono");
    await expect(sheet.locator(".notice-row", { hasText: "Zed Mono" })).toContainText("OFL-1.1");
  });
});

test.describe("the window's reach", () => {
  test("is sandboxed, and opens only the project's own files", async ({ launched: { app, window: page }, scratch }) => {
    await expect(page.locator(".editor textarea")).toHaveValue(/Greeter/);
    // The window's renderer, as the system sees it: sandboxed (said on macOS; Linux leaves it unsaid).
    const sandboxed = await app.evaluate(({ app, BrowserWindow }) => {
      const pid = BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId();
      return app.getAppMetrics().find((metric) => metric.pid === pid)?.sandboxed;
    });
    if (process.platform === "darwin") expect(sandboxed).toBe(true);
    const outside = await page.evaluate(() => window.turri.openPath("/bin/sh").then(() => "opened", (error: Error) => error.message));
    expect(outside).toMatch(/not a file of this project/);
    // An empty folder the new-project sheet did not make is not its to take away.
    const empty = join(scratch, "empty");
    mkdirSync(empty);
    await page.evaluate((dir) => window.turri.abandonProject(dir), empty);
    expect(existsSync(empty)).toBe(true);
  });
});
