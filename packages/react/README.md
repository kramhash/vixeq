# @vixeq/react

React hooks for `@vixeq/core`.

```tsx
import { useSequencerEngine } from "@vixeq/react";

const player = useSequencerEngine({ project, onStep });
await player.play();
```

## Controlled Project Usage

```tsx
import { createProject, toggleStep, type SequenceProject } from "@vixeq/core";
import { useSequencerEngine } from "@vixeq/react";
import { useState } from "react";

function Sequencer() {
  const [project, setProject] = useState<SequenceProject>(() => createProject());
  const player = useSequencerEngine({ project });
  const trackId = project.tracks[0].id;

  return (
    <>
      <button type="button" onClick={() => void player.toggle()}>
        {player.isPlaying ? "Stop" : "Play"}
      </button>
      <button type="button" onClick={() => setProject(toggleStep(project, trackId, 0))}>
        Toggle first step
      </button>
    </>
  );
}
```

The hook owns the `SequencerEngine` lifecycle and updates the engine when `project` changes.

## Audio-Synced Usage

Audio is optional. When you want a sequencer to follow an `HTMLAudioElement`, pass a transport from `@vixeq/core`.

```tsx
import { createMediaElementTransport, createProject } from "@vixeq/core";
import { useSequencerEngine } from "@vixeq/react";
import { useMemo, useState } from "react";

function AudioSequencer() {
  const [project] = useState(() => createProject());
  const transport = useMemo(() => {
    const audio = new Audio("/loop.wav");
    audio.loop = true;
    return createMediaElementTransport(audio);
  }, []);
  const player = useSequencerEngine({ project, transport, timeDriven: true });

  return (
    <button type="button" disabled={player.isStarting} onClick={() => void player.toggle()}>
      {player.isStarting ? "Starting..." : player.isPlaying ? "Stop" : "Play"}
    </button>
  );
}
```

## Animated Channels

Drive CSS custom properties (or any per-frame sink) with a `requestAnimationFrame` loop, using either envelope-based or interpolation-based values.

### Envelope mode

Pass a map of `trackId → Envelope` to trigger and sample beat-driven decay animations:

```tsx
import { createDecayEnvelope } from "@vixeq/core";
import { bindChannelsToElement } from "@vixeq/core/dom";
import { useAnimatedChannels, useSequencerEngine } from "@vixeq/react";
import { useMemo, useRef } from "react";

const ENVELOPES = {
  [beatTrackId]: createDecayEnvelope({ decayRate: 4.5, impact: 1.0, lift: 0 }),
  [ctaTrackId]:  createDecayEnvelope({ decayRate: 2.0, impact: 0.8, lift: 0 }),
};

const CSS_MAPPING = {
  [beatTrackId]: "--pulse-beat",
  [ctaTrackId]:  "--pulse-cta",
};

function PulseScene() {
  const rootRef = useRef<HTMLDivElement>(null);
  const { engine } = useSequencerEngine({ project });
  const envelopes = useMemo(() => ENVELOPES, []);

  useAnimatedChannels(engine, {
    envelopes,
    onFrame: (values) => {
      if (rootRef.current) bindChannelsToElement(rootRef.current, values, CSS_MAPPING);
    },
  });

  return <div ref={rootRef} className="scene" />;
}
```

### Interpolation mode

Without `envelopes`, the hook calls `engine.sampleChannels(now, easing)` each frame for smooth step-to-step morphing:

```tsx
import { easeOutCubic } from "@vixeq/core";
import { useAnimatedChannels, useSequencerEngine } from "@vixeq/react";

function MorphScene() {
  const { engine } = useSequencerEngine({ project });
  const valuesRef = useAnimatedChannels(engine, {
    easing: easeOutCubic,
    onFrame: (values) => { /* write to DOM */ },
  });
  // valuesRef.current holds the latest { trackId: 0–1 } map
}
```

### `reducedMotion`

Pass `reducedMotion: true` to pause the rAF loop. The hook does not read `window.matchMedia` — wire it yourself via a state variable. A `usePrefersReducedMotion()` helper is planned for a future release.

### `latestEvent`

When you don't have direct access to the engine (e.g., you're using `SequencePlayer`), pass `latestEvent` from an `onStep` callback to trigger envelopes:

```tsx
const [latestEvent, setLatestEvent] = useState<StepEvent | null>(null);

useAnimatedChannels(null, {
  envelopes,
  latestEvent,
  onFrame: (values) => { /* ... */ },
});
```

---

This package is a thin React integration layer for the core engine. It does not include GUI, visualizer, shader, storage, or audio components.
