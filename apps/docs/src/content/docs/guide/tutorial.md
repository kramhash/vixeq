---
title: "Tutorial: Your first sequencer in React"
description: Build a small React app that plays a vixeq sequence and pulses a visual in time.
---

This tutorial builds a minimal React app from scratch: create a project, play
it with a hook, then drive a visual so a square pulses on every beat. It
assumes React 18+ and covers `@vixeq/core` and `@vixeq/react` only — for a
ready-made editor GUI instead of a hand-rolled one, see
[`@vixeq/player-react`](/guide/player-react/).

## Install

```sh
npm install @vixeq/core @vixeq/react
```

## 1. Create a project

A fresh `SequenceProject` starts with every step at `0` — nothing to play
yet. Turn a few steps on with `toggleStep` so there's something to hear (or
in this case, see) from the start:

```tsx
import { createProject, toggleStep, type SequenceProject } from "@vixeq/core";
import { useState } from "react";

const initialProject = (): SequenceProject => {
  let project = createProject({ bpm: 120, stepCount: 16, trackCount: 1, trackNames: ["Gate"] });
  const trackId = project.tracks[0].id;
  // Turn on every 4th step (a steady quarter-note pulse).
  for (let step = 0; step < project.stepCount; step += 4) {
    project = toggleStep(project, trackId, step);
  }
  return project;
};

function App() {
  const [project, setProject] = useState<SequenceProject>(initialProject);
  const trackId = project.tracks[0].id;
  // ...
}
```

Keep a reference to `trackId` — every project step, playback event, and
sampled channel is keyed by each track's generated `id` (e.g. `"track-1"`),
not by its display name.

## 2. Play it

`useSequencerEngine` owns the `SequencerEngine` lifecycle: it creates the
engine on mount, hot-swaps it whenever `project` changes, and disposes it on
unmount.

```tsx
import { useSequencerEngine } from "@vixeq/react";

function App() {
  const [project, setProject] = useState<SequenceProject>(initialProject);
  const player = useSequencerEngine({ project });

  return (
    <button type="button" onClick={() => void player.toggle()}>
      {player.playbackState === "playing" ? "Pause" : "Play"}
    </button>
  );
}
```

Clicking the button now starts the transport and steps through the project
in time with `bpm`. There's no sound and nothing on screen yet — just a
running clock.

## 3. Drive a visual

`useAnimatedChannels` samples every track's current value on a
`requestAnimationFrame` loop and hands it to `onFrame`, without triggering a
React re-render per frame. Use it to write the sampled value straight to the
DOM as a CSS custom property with `bindChannelsToElement`, keyed by the same
`trackId` from step 1:

```tsx
import { easeOutCubic } from "@vixeq/core";
import { bindChannelsToElement } from "@vixeq/core/dom";
import { useAnimatedChannels, useSequencerEngine } from "@vixeq/react";
import { useRef } from "react";

function App() {
  const [project, setProject] = useState<SequenceProject>(initialProject);
  const trackId = project.tracks[0].id;
  const player = useSequencerEngine({ project });
  const boxRef = useRef<HTMLDivElement>(null);

  useAnimatedChannels(player.engine, {
    easing: easeOutCubic,
    onFrame: (values) => {
      if (!boxRef.current) return;
      bindChannelsToElement(boxRef.current, values, { [trackId]: "--gate" });
    },
  });

  return (
    <>
      <button type="button" onClick={() => void player.toggle()}>
        {player.playbackState === "playing" ? "Pause" : "Play"}
      </button>
      <div ref={boxRef} className="pulse-box" />
    </>
  );
}
```

`values` is a `{ trackId: 0–1 }` map; `--gate` is just a name we chose for
the CSS custom property. The mapping from CSS variable to visible motion
lives entirely in CSS:

```css
.pulse-box {
  width: 96px;
  height: 96px;
  background: hotpink;
  opacity: var(--gate, 0);
  transform: scale(calc(0.8 + 0.2 * var(--gate, 0)));
  transition: opacity 60ms linear, transform 60ms linear;
}
```

Press Play, and the square should now pulse on every beat you toggled on in
step 1.

`useAnimatedChannels` follows `prefers-reduced-motion` by default (pass
`motionPreference: "reduce"` or `"no-preference"` to override), so this
respects a visitor's OS-level motion setting without extra code.

## Full example

```tsx
import { createProject, easeOutCubic, toggleStep, type SequenceProject } from "@vixeq/core";
import { bindChannelsToElement } from "@vixeq/core/dom";
import { useAnimatedChannels, useSequencerEngine } from "@vixeq/react";
import { useRef, useState } from "react";

const initialProject = (): SequenceProject => {
  let project = createProject({ bpm: 120, stepCount: 16, trackCount: 1, trackNames: ["Gate"] });
  const trackId = project.tracks[0].id;
  for (let step = 0; step < project.stepCount; step += 4) {
    project = toggleStep(project, trackId, step);
  }
  return project;
};

export function App() {
  const [project] = useState<SequenceProject>(initialProject);
  const trackId = project.tracks[0].id;
  const player = useSequencerEngine({ project });
  const boxRef = useRef<HTMLDivElement>(null);

  useAnimatedChannels(player.engine, {
    easing: easeOutCubic,
    onFrame: (values) => {
      if (!boxRef.current) return;
      bindChannelsToElement(boxRef.current, values, { [trackId]: "--gate" });
    },
  });

  return (
    <>
      <button type="button" onClick={() => void player.toggle()}>
        {player.playbackState === "playing" ? "Pause" : "Play"}
      </button>
      <div ref={boxRef} className="pulse-box" />
    </>
  );
}
```

## Next steps

- Full hook reference — [`@vixeq/react` guide](/guide/react/) and
  [`useSequencerEngine` API](/api/vixeq/react/functions/usesequencerengine/)
- Prefer a ready-made, editable grid UI instead of a hand-rolled one? See the
  [`@vixeq/player-react` guide](/guide/player-react/)
- Turn the pulse into a playable timing challenge —
  [`Build a rhythm game in React`](/guide/rhythm-game/)
- Multi-pattern songs and cue timelines — [`useArrangement` and
  `useTimeline`](/guide/react/#arrangement-and-timeline-hooks)
- Copyable example with a richer visual —
  `pnpm --filter vixeq-example-website-pulse dev`
  (see [`examples/website-pulse`](https://github.com/kramhash/vixeq/tree/main/examples/website-pulse))
