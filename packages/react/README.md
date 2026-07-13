# @vixeq/react

React hooks for `@vixeq/core`.

## Support

The current React peer range, TypeScript range, SSR expectations, and semver
policy are documented in the repository
[support policy](https://github.com/kramhash/vixeq/blob/main/SUPPORT.md).
`@vixeq/react` supports React `>=18 <20`.

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
        {player.playbackState === "playing" ? "Pause" : "Play"}
      </button>
      <button type="button" onClick={() => setProject(toggleStep(project, trackId, 0))}>
        Toggle first step
      </button>
    </>
  );
}
```

The hook owns the `SequencerEngine` lifecycle and updates the engine when `project` changes.
Continuous transport progress is exposed through `positionRef.current` and
`onPosition` instead of per-frame React state. `pendingOperation` is the queued
command head, and `isBusy` is true while a command is queued or running.
Both sequencer and arrangement hooks expose transport-level controls:
`seekPositionMs`, `setPlaybackRate`, and `setTransportLoop`. Arrangement also
exposes `setLoop` for its local project loop behavior.

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
  const player = useSequencerEngine({ project, transport });

  return (
    <button type="button" disabled={player.isBusy} onClick={() => void player.toggle()}>
      {player.pendingOperation ? "Working..." : player.playbackState === "playing" ? "Pause" : "Play"}
    </button>
  );
}
```

## Arrangement Usage

`useArrangement` mirrors `useSequencerEngine`'s lifecycle (create on mount,
dispose on unmount, hot-swap on prop change) for an `ArrangementProject` — a
song-level structure with tempo-mapped timing, an explicit duration, and
multiple patterns placed on a shared beat timeline.

```tsx
import { createArrangement, createTimingMap } from "@vixeq/core";
import { useAnimatedChannels, useArrangement } from "@vixeq/react";

function Song() {
  const [arrangement] = useState(() =>
    createArrangement({
      timing: createTimingMap({ bpm: 120 }),
      durationBeats: 32,
      patterns,
      sections,
    }),
  );
  const player = useArrangement({ arrangement });

  // engine satisfies ChannelSource, so it composes directly with useAnimatedChannels
  useAnimatedChannels(player.engine, {
    onFrame: (values) => { /* write to DOM */ },
  });

  return (
    <>
      <button type="button" disabled={player.isBusy} onClick={() => void player.toggle()}>
        {player.playbackState === "playing" ? "Pause" : "Play"}
      </button>
      <button type="button" onClick={() => void player.seekBeat(16)}>Jump to chorus</button>
      <span>{player.currentSection?.id ?? "(gap)"}</span>
    </>
  );
}
```

`projectError` captures constructor/hot-swap failures (e.g. an invalid arrangement) without throwing during render. `transportError` captures playback command failures and command promises still reject.

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

Without `envelopes`, the hook calls `engine.sampleChannels(easing)` each frame for smooth step-to-step morphing:

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

### `motionPreference`

The hook follows `prefers-reduced-motion` by default. Pass `motionPreference: "reduce"` to stop the rAF loop and use static samples, or `"no-preference"` to keep the rAF loop running regardless of the OS setting:

```tsx
import { useAnimatedChannels } from "@vixeq/react";

useAnimatedChannels(engine, { motionPreference: "reduce" });
```

Envelope mode requires a `ChannelSource`. It triggers envelopes from
`StepEvent.scheduledPositionMs`, samples with `engine.getPosition().positionMs`,
and resets envelopes on seek, stop, and affected Project changes. In reduced
motion, ordinary step ticks are ignored, but explicit seek, stop, and Project
changes still produce one fresh static sample.

---

This package is a thin React integration layer for the core engine. It does not include GUI, visualizer, shader, storage, or audio components.
