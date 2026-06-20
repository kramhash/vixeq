import { describe, expect, it } from "vitest";
import { createProject, setStepValue } from "@vixeq/core";
import { getPatternComplexity } from "./visualizerState";

describe("getPatternComplexity", () => {
  it("increases when the pattern has more weighted activity", () => {
    const base = createProject({ stepCount: 16, trackCount: 4 });
    const sparse = setStepValue(base, base.tracks[0].id, 0, 1);
    let complex = sparse;
    complex = setStepValue(complex, complex.tracks[1].id, 1, 1);
    complex = setStepValue(complex, complex.tracks[2].id, 3, 1);
    complex = setStepValue(complex, complex.tracks[2].id, 7, 0.75);

    expect(getPatternComplexity(complex, 3)).toBeGreaterThan(getPatternComplexity(sparse, 0));
  });

  it("responds to local activity around the current step", () => {
    let project = createProject({ stepCount: 16, trackCount: 4 });
    project = setStepValue(project, project.tracks[2].id, 4, 1);
    project = setStepValue(project, project.tracks[2].id, 5, 1);

    expect(getPatternComplexity(project, 5)).toBeGreaterThan(getPatternComplexity(project, 12));
  });
});
