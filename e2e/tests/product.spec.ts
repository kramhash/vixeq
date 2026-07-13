import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath, URL } from "node:url";

// R3 "Browser gates" -- product half. Drives the real website-pulse example
// (real <AudioBuffer> transport via WebAudio, no fake clock) across all 3
// browsers. Selectors are accessible-first (role/label/text); a single
// data-testid covers the position readout, which has no other stable
// accessible handle. See docs/plans/v1-collaboration-spec.md Section 11 for
// the full coverage list this mirrors (play/pause/stop/seek/rate/loop/
// custom-audio/reduced-motion/errors).

const APP_URL = "http://127.0.0.1:4181/";
const DEMO_LOOP_PATH = fileURLToPath(
  new URL("../../examples/website-pulse/public/demo-loop.wav", import.meta.url),
);

const isCiFirefox = (browserName: string) =>
  browserName === "firefox" && process.env.CI === "true";

const expectPauseVisibleOrSkipAudioCapability = async (
  page: Page,
  browserName: string,
  timeout = 5000,
) => {
  const pauseButton = page.getByRole("button", { name: "Pause" });
  try {
    await expect(pauseButton).toBeVisible({ timeout });
  } catch (error) {
    test.skip(
      isCiFirefox(browserName),
      "Firefox/Linux headless did not start the real WebAudio transport in this environment",
    );
    throw error;
  }
};

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
});

test("play/pause/stop toggle the transport and its button labels", async ({ page, browserName }) => {
  const toggleButton = page.getByRole("button", { name: /^(Play|Pause|Working\.\.\.)$/ });
  const stopButton = page.getByRole("button", { name: "Stop" });

  // The demo loop is decoded asynchronously on load; wait for it before
  // interacting, mirroring the real "audio not ready yet" disabled state.
  await expect(toggleButton).toBeEnabled({ timeout: 15000 });
  await expect(stopButton).toBeEnabled();

  await toggleButton.click();
  await expectPauseVisibleOrSkipAudioCapability(page, browserName);

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();

  await stopButton.click();
  await expect(page.getByTestId("position-readout")).toHaveText(/^0\.00s/);
});

test("scrub seeks the show timeline and updates the readout", async ({ page }) => {
  const scrub = page.getByLabel("Scrub");
  await expect(scrub).toBeEnabled({ timeout: 15000 });

  // Range inputs need the native value setter (not a plain `.value =`
  // assignment) for React's controlled-input tracking to pick up the
  // change, so drive it directly rather than via locator.fill().
  await scrub.evaluate((el: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, "2000");

  await expect(page.getByTestId("position-readout")).toHaveText(/^2\.00s/);
});

test("playback rate and full-show loop controls update without error", async ({ page }) => {
  const rateSelect = page.getByLabel("Rate");
  const loopCheckbox = page.getByLabel("Full-show loop");
  await expect(rateSelect).toBeEnabled({ timeout: 15000 });

  await rateSelect.selectOption("1.25");
  await expect(rateSelect).toHaveValue("1.25");

  await loopCheckbox.check();
  await expect(loopCheckbox).toBeChecked();

  // Neither control should have raised the shared error alert.
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("loading a custom audio file replaces the transport and autoplays", async ({ page, browserName }) => {
  const fileInput = page.getByLabel("Load your own track");
  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled({ timeout: 15000 });

  await fileInput.setInputFiles(DEMO_LOOP_PATH);

  await expectPauseVisibleOrSkipAudioCapability(page, browserName, 15000);
});

test("an undecodable audio file surfaces the error alert", async ({ page }) => {
  const fileInput = page.getByLabel("Load your own track");
  await expect(fileInput).toBeVisible();

  await fileInput.setInputFiles({
    name: "not-audio.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("this is not an audio file"),
  });

  // `decodeAudioData`'s rejection message is a native, engine-specific
  // DOMException string (e.g. Chromium: "Unable to decode audio data";
  // Firefox: "The buffer passed to decodeAudioData contains an unknown
  // content type."; WebKit: "Decoding failed") -- App.tsx surfaces
  // `error.message` verbatim, so assert the alert appears with non-empty
  // text rather than pinning exact wording.
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).not.toBeEmpty();
});

test("reduced-motion preference shows the paused-motion notice", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();

  await expect(page.getByRole("status")).toContainText(/reduced-motion preference detected/i);
});

test("real audio playback advances the position readout", async ({ page, browserName }) => {
  const toggleButton = page.getByRole("button", { name: /^(Play|Working\.\.\.)$/ });
  await expect(toggleButton).toBeEnabled({ timeout: 15000 });

  await toggleButton.click();
  await page.waitForTimeout(1500);

  const readoutText = (await page.getByTestId("position-readout").innerText()).trim();
  const elapsedSeconds = Number.parseFloat(readoutText);

  // WebAudio's AudioContext.currentTime is not guaranteed to advance under
  // every headless browser/CI combination (notably Linux WebKit and Firefox) -- capability-gate
  // rather than assert unconditionally, per the spec's "no unrealistically
  // tight real-media tolerances" gate. The deterministic harness suite
  // (media.spec.ts) already covers exact timing.
  test.skip(
    (browserName === "webkit" || isCiFirefox(browserName)) && elapsedSeconds === 0,
    `${browserName} did not advance AudioContext.currentTime in this environment`,
  );

  expect(elapsedSeconds).toBeGreaterThan(0);
});
