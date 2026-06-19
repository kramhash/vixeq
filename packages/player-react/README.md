# @viseq/player-react

Embeddable React sequence player GUI for `@viseq/core` projects.

```tsx
import { SequencePlayer } from "@viseq/player-react";
import "@viseq/player-react/styles.css";

<SequencePlayer project={project} onProjectChange={({ project }) => setProject(project)} />;
```

This package includes the editable player surface and styles for `SequenceProject` values. It does not include a visualizer, shader, app shell, storage, MIDI, or audio engine.
