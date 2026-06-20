# @vixeq/react

React hooks for `@vixeq/core`.

```tsx
import { useSequencerEngine } from "@vixeq/react";

const player = useSequencerEngine({ project, onStep });
player.play();
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
      <button type="button" onClick={player.toggle}>
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

This package is a thin React integration layer for the core engine. It does not include GUI, visualizer, shader, storage, or audio components.
