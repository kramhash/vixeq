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

This package is a thin React integration layer for the core engine. It does not include GUI, visualizer, shader, storage, or audio components.
