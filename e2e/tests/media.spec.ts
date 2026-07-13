import { test, expect } from "@playwright/test";
import "./support/harness";

// R3 "Browser gates" (docs/plans/v1-collaboration-spec.md): actual media
// transport E2E in Chromium/Firefox/WebKit, covering play/pause/stop/seek/
// rate/loop/natural-end/errors/shared-Engine-sync, with exact timing
// assertions via a deterministic fake transport.
//
// Determinism comes from Playwright's Clock API (page.clock), which fakes
// performance.now/setTimeout page-wide -- the harness itself just uses the
// shipped `browserClock`, so this exercises the real production code path.

const HARNESS_URL = "http://127.0.0.1:4180/";
const DURATION_MS = 4000; // must match e2e/harness/src/main.ts DURATION_MS

test.beforeEach(async ({ page }) => {
  // Install the fake clock before navigating so the transport's initial
  // clock anchor is captured under fake time, not real wall-clock time.
  // `install()` alone still auto-ticks with real wall-clock time in the
  // background (only setTimeout/etc. become fast-forwardable); `pauseAt`
  // freezes it so every millisecond of elapsed time comes from an explicit
  // `runFor`, which is what makes the exact-timing assertions below exact.
  // The pause target must be in the future relative to whatever the clock
  // has auto-ticked to by the time the command lands (a few ms of real IPC
  // latency), hence pausing well past the `install({ time: 0 })` baseline
  // rather than at it -- the absolute value is otherwise irrelevant, since
  // the transport only ever reads elapsed differences.
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(60_000);
  await page.goto(HARNESS_URL);
});

test("play advances position in lockstep with the fake clock", async ({ page }) => {
  await page.evaluate(() => window.__h.play());
  await page.clock.runFor(500);

  const snapshot = await page.evaluate(() => window.__h.getSnapshot());
  expect(snapshot.state).toBe("playing");
  expect(snapshot.positionMs).toBeCloseTo(500, 0);
});

test("pause freezes position", async ({ page }) => {
  await page.evaluate(() => window.__h.play());
  await page.clock.runFor(500);
  await page.evaluate(() => window.__h.pause());
  await page.clock.runFor(1000);

  const snapshot = await page.evaluate(() => window.__h.getSnapshot());
  expect(snapshot.state).toBe("paused");
  expect(snapshot.positionMs).toBeCloseTo(500, 0);
});

test("stop resets position to zero", async ({ page }) => {
  await page.evaluate(() => window.__h.play());
  await page.clock.runFor(500);
  await page.evaluate(() => window.__h.stop());

  const snapshot = await page.evaluate(() => window.__h.getSnapshot());
  expect(snapshot.state).toBe("stopped");
  expect(snapshot.positionMs).toBe(0);
});

test("seek jumps position and emits a seek event", async ({ page }) => {
  const result = await page.evaluate(() => window.__h.seekMs(1500));
  expect(result.ok).toBe(true);

  const snapshot = await page.evaluate(() => window.__h.getSnapshot());
  expect(snapshot.positionMs).toBe(1500);

  const events = await page.evaluate(() => window.__h.getTransportEvents());
  expect(events).toContain("seek");
});

test("playback rate scales elapsed time", async ({ page }) => {
  await page.evaluate(() => window.__h.setPlaybackRate(2));
  await page.evaluate(() => window.__h.play());
  await page.clock.runFor(500);

  const snapshot = await page.evaluate(() => window.__h.getSnapshot());
  expect(snapshot.playbackRate).toBe(2);
  expect(snapshot.positionMs).toBeCloseTo(1000, 0);
});

test("loop wraps at the duration boundary", async ({ page }) => {
  await page.evaluate(() => window.__h.setLoop(true));
  await page.evaluate(() => window.__h.play());
  await page.clock.runFor(DURATION_MS + 500);

  const snapshot = await page.evaluate(() => window.__h.getSnapshot());
  expect(snapshot.loop).toBe(true);
  expect(snapshot.state).toBe("playing");
  expect(snapshot.positionMs).toBeCloseTo(500, 0);

  const events = await page.evaluate(() => window.__h.getTransportEvents());
  expect(events).toContain("loop");
});

test("natural end fires without loop", async ({ page }) => {
  await page.evaluate(() => window.__h.play());
  await page.clock.runFor(DURATION_MS + 200);

  const snapshot = await page.evaluate(() => window.__h.getSnapshot());
  expect(snapshot.state).toBe("ended");
  expect(snapshot.positionMs).toBe(DURATION_MS);

  const events = await page.evaluate(() => window.__h.getTransportEvents());
  expect(events).toContain("ended");
});

test("operations after dispose reject with TRANSPORT_DISPOSED", async ({ page }) => {
  await page.evaluate(() => window.__h.dispose());
  const result = await page.evaluate(() => window.__h.play());

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toContain("TRANSPORT_DISPOSED");
  }
});

test("seeking past duration rejects with a RangeError", async ({ page }) => {
  const result = await page.evaluate(
    (overshootMs) => window.__h.seekMs(overshootMs),
    DURATION_MS + 1000,
  );

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toContain("RangeError");
  }
});

test("shared-Engine synchronization: SequencerEngine and TimelineEngine track one transport", async ({ page }) => {
  await page.evaluate(() => window.__h.play());
  await page.clock.runFor(2000);

  const [sequencerPosition, timelinePosition, lastCue] = await page.evaluate(() => [
    window.__h.getSequencerPosition(),
    window.__h.getTimelinePosition(),
    window.__h.getLastCue(),
  ]);

  // Both engines were constructed with the SAME transport instance, so their
  // reported positions must agree -- this is the crux of the "shared-Engine
  // synchronization" gate.
  expect(sequencerPosition.positionMs).toBeCloseTo(timelinePosition.positionMs, 0);
  expect(sequencerPosition.positionMs).toBeCloseTo(2000, 0);

  // The timeline cue at beat 4 (2000ms, see harness main.ts) must have fired
  // at the same shared position.
  expect(lastCue).not.toBeNull();
  expect(lastCue?.label).toBe("mid");
  expect(lastCue?.positionMs).toBeCloseTo(2000, 0);

  const values = await page.evaluate(() => window.__h.sample());
  const trackId = await page.evaluate(() => window.__h.trackId);
  expect(values[trackId]).toBeGreaterThanOrEqual(0);
  expect(values[trackId]).toBeLessThanOrEqual(1);

  const channelTarget = page.locator("#channel-target");
  await expect(channelTarget).toHaveCSS("--channel-value", String(values[trackId]?.toFixed(4)));
});
