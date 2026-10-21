import type { ElectronApplication, Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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

test.describe("a project's settings", () => {
  test("are behind the sidebar's gear, and changed through /turri-config", async ({ launched: { window: page, project } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    await page.getByRole("button", { name: "project settings" }).click();
    const sheet = page.getByRole("dialog", { name: "project settings" });
    // As config.turri.yaml has them, the models among turri's own choices.
    await expect(sheet.getByRole("combobox", { name: "harness-model", exact: true })).toHaveValue("anthropic/claude-sonnet-5-5");
    await expect(sheet.getByRole("combobox", { name: "conformance-tests" })).toHaveValue("false");
    await expect(sheet.getByRole("combobox", { name: "conformance-tests" }).locator("option")).toHaveText(["unset - all, where a module has test reqs", "all", "chosen", "module", "false"]);
    // Every setting of the file, as /turri-config knows them - not only the ones the sidebar used to show.
    await expect(sheet.getByRole("switch", { name: "mutation-testing" })).toBeVisible();
    await expect(sheet.getByRole("switch", { name: "release-after-pulse" })).toBeVisible();
    const review = sheet.getByRole("switch", { name: "review" });
    await expect(review).toHaveAttribute("aria-checked", "false");
    // Sent as the person would type it - a slash command, no model called - and written into the file, comments kept.
    await review.click();
    await expect(page.locator(".chat-body")).toContainText("review: true - written to config.turri.yaml, in effect from the next pulse");
    await expect.poll(() => readFileSync(join(project, "config.turri.yaml"), "utf8")).toMatch(/^review: true$/m);
    expect(readFileSync(join(project, "config.turri.yaml"), "utf8")).toContain("# The app's tests open this project");
    await expect(review).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("⌘R", () => {
  test("reloads the window back onto its project, not its welcome screen", async ({ launched: { app, window: page } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    await choose(app, page, "reload");
    await page.waitForEvent("domcontentloaded");
    // The project it had, its engine never stopped - the conversation taken up from it.
    await expect(page.locator(".editor-pane .pane-header")).toContainText("hello.plain");
    await expect(page.locator(".welcome")).toHaveCount(0);
    await expect(page.locator(".chat-model")).toHaveText("claude-sonnet-5-5");
  });

  test("in the preview reloads its page, never the window", async ({ launched: { app, window: page } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    await page.getByRole("tab", { name: "preview" }).click();
    await page.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
    await choose(app, page, "reload");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
    await expect(page.getByRole("tab", { name: "preview", selected: true })).toBeVisible();
  });
});

test.describe("the files' sidebar", () => {
  test("hides and shows, by the toolbar's button and ⌘B, and stays as it was left", async ({ launched: { app, window: page } }) => {
    const sidebar = page.locator(".sidebar");
    const toggle = page.getByRole("button", { name: "hide the files" });
    await expect(sidebar).toBeVisible();
    await toggle.click();
    await expect(sidebar).toHaveCount(0);
    await expect(page.getByRole("button", { name: "show the files" })).toHaveAttribute("aria-pressed", "false");
    // Hidden it stays, the window drawn again.
    await page.reload();
    await expect(page.locator(".chat-model")).toBeVisible();
    await expect(sidebar).toHaveCount(0);
    // View > Show or Hide the Files, ⌘B: as the menu sends it.
    await choose(app, page, "sidebar");
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole("button", { name: "hide the files" })).toHaveAttribute("aria-pressed", "true");
  });

  test("hidden, leaves the toolbar's buttons at its left - right of the traffic lights, or at the edge full screen", async ({ launched: { app, window: page } }) => {
    await page.getByRole("button", { name: "hide the files" }).click();
    const left = () => page.locator(".sidebar-toggle").evaluate((button) => Math.round(button.getBoundingClientRect().left));
    const tabs = () => page.locator(".toolbar .segmented").evaluate((tabs) => Math.round(tabs.getBoundingClientRect().left));
    const lights = process.platform === "darwin" ? 78 : 12;
    await expect.poll(left).toBe(lights);
    expect(await tabs()).toBeLessThan(lights + 40);
    // Full screen, as the main process says it: no traffic lights to leave room for.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send("fullscreen", true));
    await expect.poll(left).toBe(12);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send("fullscreen", false));
    await expect.poll(left).toBe(lights);
    // The project's settings are in the toolbar: there with the files hidden too.
    await page.getByRole("button", { name: "project settings" }).click();
    await expect(page.getByRole("dialog", { name: "project settings" })).toBeVisible();
  });

  test("starts at the window's top: the project's name in its title bar, the files straight below", async ({ launched: { window: page } }) => {
    await expect(page.locator(".tree-row").first()).toBeVisible();
    const top = (selector: string) => page.locator(selector).first().evaluate((element) => Math.round(element.getBoundingClientRect().top));
    expect(await top(".project-name")).toBe(0);
    expect(await top(".sidebar-section")).toBe(52);
    expect(await top(".tree-row")).toBeLessThan(100);
  });

  test("is shown or hidden on ⌘B, by View's menu", async ({ launched: { app } }) => {
    const item = await app.evaluate(({ Menu }) => {
      const view = Menu.getApplicationMenu()!.items.find((each) => each.label === "View")!;
      const files = view.submenu!.items.find((each) => each.label === "Show or Hide the Files");
      return files?.accelerator ?? null;
    });
    expect(item).toBe("CmdOrCtrl+B");
  });
});

test.describe("the window's text", () => {
  // A button's label is not among them: a click presses it - or, disabled, is not heard - as in any app.
  test("can all be selected, as in a document - the sidebar, the headers, the chat", async ({ launched: { window: page } }) => {
    await expect(page.locator(".chat-model")).toBeVisible();
    for (const [where, text] of [
      [page.locator(".sidebar-section", { hasText: "files" }), "files"],
      [page.locator(".project-name span"), "hello"],
      [page.locator(".chat-title"), "turri"],
      [page.locator(".chat-model"), "claude-sonnet-5-5"],
      [page.locator(".editor-pane .pane-header").getByText("hello.plain", { exact: true }), "hello.plain"],
      [page.locator(".editor-pane .pane-header").getByText("0 of 1 built"), "0 of 1 built"],
    ] as const) {
      await where.click({ clickCount: 3 });
      expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toContain(text);
    }
  });
});
