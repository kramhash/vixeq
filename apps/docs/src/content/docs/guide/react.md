---
title: "@vixeq/react"
description: React hooks for the Vixeq step sequencer engine.
---

React hooks for [`@vixeq/core`](../core/) — no GUI, no styles, just
lifecycle-managed engines.

## Install

```sh
npm install @vixeq/core @vixeq/react
```

## Getting started

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

`useSequencerEngine` owns the `SequencerEngine` lifecycle (create on mount,
dispose on unmount, hot-swap when `project` changes). Continuous transport
progress is exposed through `positionRef.current` / `onPosition` instead of
per-frame React state; `isBusy` is true while a command is queued or running.

## Arrangement and timeline hooks

`useArrangement` and `useTimeline` mirror the same lifecycle for
`ArrangementEngine` and `TimelineEngine` — see
[Concepts](../concepts/) for how the three engines differ:

```tsx
import { createArrangement, createTimingMap } from "@vixeq/core";
import { useArrangement } from "@vixeq/react";

const player = useArrangement({
  arrangement: createArrangement({
    timing: createTimingMap({ bpm: 120 }),
    durationBeats: 32,
    patterns,
    sections,
  }),
});

await player.seekBeat(16); // jump to the chorus
```

## Animated channels

Drive CSS custom properties (or any per-frame sink) from a
`requestAnimationFrame` loop, in envelope or easing/interpolation mode:

```tsx
import { easeOutCubic } from "@vixeq/core";
import { useAnimatedChannels, useSequencerEngine } from "@vixeq/react";

function MorphScene() {
  const { engine } = useSequencerEngine({ project });
  const valuesRef = useAnimatedChannels(engine, {
    easing: easeOutCubic,
    onFrame: (values) => {
      /* write to DOM */
    },
  });
  // valuesRef.current holds the latest { trackId: 0–1 } map
}
```

`useAnimatedChannels` follows `prefers-reduced-motion` by default — pass
`motionPreference: "reduce"` or `"no-preference"` to override
(`usePrefersReducedMotion` is also exported standalone).

## Next steps

- Full API — [`useSequencerEngine` reference](../../api/vixeq/react/functions/usesequencerengine/)
- Editable player GUI — [`@vixeq/player-react` guide](../player-react/)
- Copyable example: `pnpm --filter vixeq-example-arrangement-demo dev`
  (see [`examples/arrangement-demo`](https://github.com/kramhash/vixeq/tree/main/examples/arrangement-demo))
