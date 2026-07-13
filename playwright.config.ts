import { defineConfig, devices } from "@playwright/test";

// R3 browser gate (docs/plans/v1-collaboration-spec.md Section "Browser
// gates"): run media-transport E2E in Chromium, Firefox, and WebKit against
// two targets —
//   - e2e/harness (port 4180): a deterministic transport driven by
//     Playwright's Clock API, for exact-timing / shared-Engine assertions.
//   - examples/website-pulse (port 4181): the real-audio product flagship,
//     for loose-tolerance UI/product assertions.
// Both are served from their production build via `vite preview`, matching
// what ships.
export default defineConfig({
  testDir: "./e2e/tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "pnpm --filter vixeq-e2e-harness run preview",
      url: "http://127.0.0.1:4180",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm --filter vixeq-example-website-pulse run preview",
      url: "http://127.0.0.1:4181",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
