# @viseq/react

React hooks for `@viseq/core`.

```tsx
import { useSequencerEngine } from "@viseq/react";

const player = useSequencerEngine({ project, onStep });
player.play();
```

This package is a thin React integration layer for the core engine. It does not include GUI, visualizer, shader, storage, or audio components.
