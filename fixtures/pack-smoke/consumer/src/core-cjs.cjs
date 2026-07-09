const {
  SequencerEngine,
  createProject,
  setStepValue,
  validateProject,
} = require("@vixeq/core");

const baseProject = createProject({
  bpm: 128,
  stepCount: 8,
  trackCount: 1,
  trackNames: ["Packed CJS"],
});
const project = setStepValue(baseProject, baseProject.tracks[0].id, 0, 1);
const validation = validateProject(project);

if (!validation.ok) {
  throw new Error(`Expected packed CJS project to validate: ${validation.errors[0]?.message}`);
}

const engine = new SequencerEngine(project, { lookaheadMs: 0 });
const channels = engine.sampleChannelsAt(0);

if (channels[project.tracks[0].id] !== 1) {
  throw new Error("Expected packed CJS import to sample the first step.");
}

engine.dispose();
