---
title: "@vixeq/player-react"
description: An embeddable, editable React sequence player GUI for Vixeq projects.
---

An embeddable, editable React sequence player GUI for
[`@vixeq/core`](/guide/core/) projects, with bundled styles. No visualizer,
app shell, storage, MIDI, or audio engine.

## Install

```sh
npm install @vixeq/core @vixeq/react @vixeq/player-react
```

## Getting started

```tsx
import { SequencePlayer } from "@vixeq/player-react";
import "@vixeq/player-react/styles.css";

<SequencePlayer project={project} onProjectChange={({ project }) => setProject(project)} />;
```

## Controlled usage

```tsx
import { createProject, randomizeTrack, type SequenceProject } from "@vixeq/core";
import { SequencePlayer, type SequencePlayerRef } from "@vixeq/player-react";
import "@vixeq/player-react/styles.css";
import { useRef, useState } from "react";

function App() {
  const [project, setProject] = useState<SequenceProject>(() => createProject());
  const ref = useRef<SequencePlayerRef>(null);
  const trackId = project.tracks[0].id;

  return (
    <>
      <button type="button" onClick={() => void ref.current?.play()}>
        Play
      </button>
      <button type="button" onClick={() => setProject(randomizeTrack(project, trackId))}>
        Randomize
      </button>
      <SequencePlayer
        ref={ref}
        project={project}
        onProjectChange={({ project: nextProject }) => setProject(nextProject)}
        onStep={(event) => console.log(event)}
      />
    </>
  );
}
```

`onProjectChange` reports a `reason`, `trackId`, and `stepIndex` when
available, so host apps can persist or inspect edits. The ref exposes `play`,
`pause`, `stop`, `toggle`, `seekStep`, `seekPositionMs`, `setPlaybackRate`,
and `setTransportLoop`.

## Audio-synced usage

`SequencePlayer` follows any `PlaybackTransport` from `@vixeq/core` — see
[Audio Sync](/guide/core/#audio-sync):

```tsx
import { createMediaElementTransport, createProject } from "@vixeq/core";
import { SequencePlayer } from "@vixeq/player-react";
import "@vixeq/player-react/styles.css";
import { useMemo, useState } from "react";

function SyncedPlayer() {
  const [project, setProject] = useState(() => createProject());
  const transport = useMemo(() => {
    const audio = new Audio("/loop.wav");
    audio.loop = true;
    return createMediaElementTransport(audio);
  }, []);

  return (
    <SequencePlayer
      project={project}
      transport={transport}
      onProjectChange={({ project: nextProject }) => setProject(nextProject)}
    />
  );
}
```

Set `showTransportControls={false}` when the host app provides its own
transport controls.

## Composing with `@vixeq/react`

`onEngineChange` exposes the underlying `SequencerEngine` so a host app can
compose `SequencePlayer` with `@vixeq/react`'s `useAnimatedChannels` for
custom visual output alongside the built-in editor:

```tsx
import { useAnimatedChannels } from "@vixeq/react";
import { SequencePlayer } from "@vixeq/player-react";
import { useState } from "react";
import type { SequencerEngine } from "@vixeq/core";

function PlayerWithVisual({ project, onProjectChange }) {
  const [engine, setEngine] = useState<SequencerEngine | null>(null);
  useAnimatedChannels(engine, {
    onFrame: (values) => {
      /* write to DOM */
    },
  });

  return (
    <SequencePlayer
      project={project}
      onEngineChange={setEngine}
      onProjectChange={onProjectChange}
    />
  );
}
```

`onPlaybackChange` reports the same Playback v2 snapshots
(`playbackState`, `positionRef`, `pendingOperation`, ...) exposed by
`useSequencePlayer` in `@vixeq/react`, for hosts that want to mirror
transport state without holding their own ref.

## Next steps

- Full API — [`SequencePlayer` reference](/api/vixeq/player-react/variables/sequenceplayer/)
- Copyable example: `pnpm --filter vixeq-example-react-player dev`
  (see [`examples/react-player`](https://github.com/kramhash/vixeq/tree/main/examples/react-player))
- Full package stack demo — the
  [hosted playground](https://kramhash.github.io/vixeq/)
