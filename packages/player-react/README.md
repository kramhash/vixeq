# @vixeq/player-react

Embeddable React sequence player GUI for `@vixeq/core` projects.

```tsx
import { SequencePlayer } from "@vixeq/player-react";
import "@vixeq/player-react/styles.css";

<SequencePlayer project={project} onProjectChange={({ project }) => setProject(project)} />;
```

## Controlled Usage

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

`onProjectChange` reports a `reason`, `trackId`, and `stepIndex` when available, so host apps can persist or inspect edits.

## Audio-Synced Usage

`SequencePlayer` can follow any `SequencerTransport`. The built-in controls will start and stop the transport before updating the sequencer.

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
      timeDriven={true}
      onProjectChange={({ project: nextProject }) => setProject(nextProject)}
    />
  );
}
```

Set `showTransportControls={false}` when the host app provides its own Play/Stop buttons and uses the component ref to control playback.

This package includes the editable player surface and styles for `SequenceProject` values. It does not include a visualizer, shader, app shell, storage, MIDI, or audio engine.
