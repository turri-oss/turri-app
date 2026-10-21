import { defineConfig } from "@playwright/test";

// The app's tests: the real window, driven by Playwright's Electron support, on a copy of tests/fixture/ - nothing in
// them calls a model. `npm test` builds the app first; they run on what is in dist/ and dist-electron/.
export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Each test is a window with an engine of its own: a few at once is plenty.
  workers: 2,
  reporter: process.env.CI ? "github" : "list",
  outputDir: "test-results",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
});
