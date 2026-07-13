import { defineConfig, devices } from "@playwright/test";

const firefoxAudioPrefs = {
  // GitHub Actions' Linux Firefox can leave WebAudio autoplay blocked even
  // when playback is initiated through Playwright's user-like click. Keep the
  // product E2E on Firefox by making the automation profile explicitly allow
  // WebAudio playback.
  "media.autoplay.default": 0,
  "media.autoplay.block-webaudio": false,
  "media.autoplay.blocking_policy": 0,
};

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
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: {
          firefoxUserPrefs: firefoxAudioPrefs,
        },
      },
    },
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
