import {
  SequencerEngine,
  createProject,
  setStepValue,
  validateProject,
} from "@vixeq/core";

const baseProject = createProject({
  bpm: 120,
  stepCount: 8,
  trackCount: 1,
  trackNames: ["Packed ESM"],
});
const project = setStepValue(baseProject, baseProject.tracks[0].id, 0, 0.75);
const validation = validateProject(project);

if (!validation.ok) {
  throw new Error(`Expected packed ESM project to validate: ${validation.errors[0]?.message}`);
}

const engine = new SequencerEngine(project, { lookaheadMs: 0 });
const channels = engine.sampleChannelsAt(0);

if (channels[project.tracks[0].id] !== 0.75) {
  throw new Error("Expected packed ESM import to sample the first step.");
}

engine.dispose();
