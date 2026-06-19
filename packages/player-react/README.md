# @viseq/player-react

Embeddable React sequence player GUI for `@viseq/core` projects.

```tsx
import { SequencePlayer } from "@viseq/player-react";
import "@viseq/player-react/styles.css";

<SequencePlayer project={project} onProjectChange={({ project }) => setProject(project)} />;
```

## Controlled Usage

```tsx
import { createProject, randomizeTrack, type SequenceProject } from "@viseq/core";
import { SequencePlayer, type SequencePlayerRef } from "@viseq/player-react";
import "@viseq/player-react/styles.css";
import { useRef, useState } from "react";

function App() {
  const [project, setProject] = useState<SequenceProject>(() => createProject());
  const ref = useRef<SequencePlayerRef>(null);
  const trackId = project.tracks[0].id;

  return (
    <>
      <button type="button" onClick={() => ref.current?.play()}>
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

`onProjectChange` reports a `reason`, `trackId`, and `stepIndex` when available, so host apps can persist or inspect edits.

This package includes the editable player surface and styles for `SequenceProject` values. It does not include a visualizer, shader, app shell, storage, MIDI, or audio engine.
