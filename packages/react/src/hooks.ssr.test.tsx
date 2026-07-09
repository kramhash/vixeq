import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createArrangement, createProject } from "@vixeq/core";
import { useArrangement } from "./useArrangement";
import { useSequencerEngine } from "./useSequencerEngine";

describe("React hooks SSR", () => {
  it("PB-SSR-001 PB-SSR-002 renders without browser APIs", () => {
    const project = createProject({ stepCount: 4, trackCount: 1 });
    const arrangement = createArrangement({
      patterns: { pattern: project },
      sections: [{ id: "intro", patternId: "pattern", startBeat: 0, endBeat: 4 }],
    });

    const SequencerProbe = () => {
      const player = useSequencerEngine({ project });
      return <span>{player.playbackState}</span>;
    };
    const ArrangementProbe = () => {
      const player = useArrangement({ arrangement });
      return <span>{player.playbackState}</span>;
    };

    expect(renderToString(<SequencerProbe />)).toContain("stopped");
    expect(renderToString(<ArrangementProbe />)).toContain("stopped");
  });
});
