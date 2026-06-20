import {
  SequencerEngine,
  clearTrack,
  createProject,
  randomizeTrack,
  rotateTrackSteps,
  setProjectBpm,
  toggleStep,
  type SequenceProject,
  type StepEvent,
} from "@vixeq/core";
import "./styles.css";

let project: SequenceProject = createProject({ bpm: 120, stepCount: 16, trackCount: 1, trackNames: ["Gate"] });
let latestEvent: StepEvent | null = null;

const engine = new SequencerEngine(project, {
  onStep: (event) => {
    latestEvent = event;
    render();
  },
});

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app root.");
}

const commitProject = (nextProject: SequenceProject) => {
  project = nextProject;
  engine.setProject(project);
  render();
};

const render = () => {
  const track = project.tracks[0];
  const currentStep = engine.getCurrentStepIndex();

  app.innerHTML = `
    <section class="shell">
      <header class="toolbar">
        <div>
          <h1>Vanilla Core</h1>
          <p>@vixeq/core without a UI framework</p>
        </div>
        <div class="transport">
          <button data-action="toggle">${engine.isPlaying() ? "Stop" : "Start"}</button>
          <button data-action="reset">Reset</button>
          <label>
            BPM
            <input data-action="bpm" type="number" min="30" max="300" step="1" value="${project.bpm}" />
          </label>
        </div>
      </header>

      <div class="pattern" aria-label="Pattern steps">
        ${track.steps
          .map(
            (value, index) => `
              <button
                class="step ${index === currentStep ? "is-current" : ""}"
                data-step="${index}"
                style="--value: ${value}"
                aria-label="Step ${index + 1}, value ${value.toFixed(2)}"
              >
                <span>${index + 1}</span>
                <strong>${value.toFixed(2)}</strong>
              </button>
            `,
          )
          .join("")}
      </div>

      <div class="actions">
        <button data-action="clear">Clear</button>
        <button data-action="rotate-left">Rotate Left</button>
        <button data-action="rotate-right">Rotate Right</button>
        <button data-action="randomize">Randomize</button>
      </div>

      <section class="event">
        <h2>Latest StepEvent</h2>
        <pre>${latestEvent ? JSON.stringify(latestEvent, null, 2) : "No step emitted yet."}</pre>
      </section>
    </section>
  `;
};

app.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>("button");
  if (!button) {
    return;
  }

  const step = button.dataset.step;
  if (step !== undefined) {
    commitProject(toggleStep(project, project.tracks[0].id, Number(step)));
    return;
  }

  switch (button.dataset.action) {
    case "toggle":
      if (engine.isPlaying()) {
        engine.stop();
      } else {
        engine.start();
      }
      render();
      break;
    case "reset":
      engine.reset(0);
      render();
      break;
    case "clear":
      commitProject(clearTrack(project, project.tracks[0].id));
      break;
    case "rotate-left":
      commitProject(rotateTrackSteps(project, project.tracks[0].id, -1));
      break;
    case "rotate-right":
      commitProject(rotateTrackSteps(project, project.tracks[0].id, 1));
      break;
    case "randomize":
      commitProject(randomizeTrack(project, project.tracks[0].id, { probability: 0.45, min: 0.35 }));
      break;
  }
});

app.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.dataset.action !== "bpm") {
    return;
  }

  const nextProject = setProjectBpm(project, Number(target.value));
  commitProject(nextProject);
  engine.setBpm(nextProject.bpm);
});

render();
