import { ArrangementEngine } from "@vixeq/core";
import "./styles.css";
import {
  WORKOUT_LIMITS,
  cloneInitialWorkout,
  sanitizeInterval,
  totalDuration,
  workoutToArrangement,
  type WorkoutInterval,
} from "./workout";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("Missing #app root.");
const app: HTMLDivElement = appRoot;

let workout = cloneInitialWorkout();
let position = 0;
let activeIntervalId = workout[0].id;
let completed = false;
let animationFrame = 0;
let nextId = 1;
let engine = createEngine();
let transportError = "";

function createEngine(): ArrangementEngine {
  const instance = new ArrangementEngine(workoutToArrangement(workout), { loop: false });
  instance.on("section", ({ section }) => {
    if (section) activeIntervalId = section.id;
    updateLiveView();
  });
  instance.on("playback", (event) => {
    position = instance.getPosition().beat;
    if (event.snapshot.state === "playing") {
      completed = false;
      startAnimation();
    } else {
      stopAnimation();
    }
    if (event.type === "stop") {
      completed = false;
      activeIntervalId = workout[0].id;
    } else if (event.type === "ended") {
      position = totalDuration(workout);
      completed = true;
    }
    render();
  });
  return instance;
}

const formatTime = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);

const runTransportCommand = (command: () => Promise<void>) => {
  transportError = "";
  void command().catch((error) => {
    transportError = error instanceof Error ? error.message : "Playback command failed.";
    render();
  });
};

const intervalAt = (seconds: number): { interval: WorkoutInterval; index: number; start: number } => {
  let start = 0;
  for (let index = 0; index < workout.length; index += 1) {
    if (seconds < start + workout[index].duration || index === workout.length - 1) {
      return { interval: workout[index], index, start };
    }
    start += workout[index].duration;
  }
  return { interval: workout[0], index: 0, start: 0 };
};

const numberInput = (index: number, field: keyof WorkoutInterval, value: number, min: number, max: number, label: string, suffix: string) => `
  <label class="field"><span>${label}</span><span class="input-wrap"><input type="number" data-index="${index}" data-field="${field}" min="${min}" max="${max}" step="1" value="${value}" ${engine.getPlaybackState() === "playing" ? "disabled" : ""}><small>${suffix}</small></span></label>`;

function render(): void {
  const duration = totalDuration(workout);
  const current = intervalAt(Math.min(position, Math.max(0, duration - 0.001)));
  const isPlaying = engine.getPlaybackState() === "playing";

  app.innerHTML = `
    <main class="app-shell">
      <header class="topbar">
        <a class="brand" href="#" aria-label="Ride Composer home"><span>RC</span> Ride Composer</a>
        <p>Powered by <strong>Vixeq</strong></p>
      </header>

      <section class="workspace">
        <section class="player-panel" aria-label="Workout player">
          <div class="player-heading">
            <div><p class="eyebrow">${completed ? "WORKOUT COMPLETE" : isPlaying ? "NOW RIDING" : "READY TO RIDE"}</p><h1>${escapeHtml(current.interval.name)}</h1></div>
            <span class="interval-count">${current.index + 1} / ${workout.length}</span>
          </div>

          <div class="timer" id="interval-time">${formatTime(current.start + current.interval.duration - position)}</div>
          <p class="timer-label">remaining in interval</p>

          <div class="targets">
            <article class="target-card cadence-card">
              <div class="target-label"><span class="target-icon">↻</span><span>Cadence</span></div>
              <strong><span id="cadence-value">${current.interval.cadenceStart}</span><small> RPM</small></strong>
              <div class="gauge"><i id="cadence-gauge"></i></div>
            </article>
            <article class="target-card resistance-card">
              <div class="target-label"><span class="target-icon">↗</span><span>Resistance</span></div>
              <strong><span id="resistance-value">${current.interval.resistanceStart}</span><small>%</small></strong>
              <div class="gauge"><i id="resistance-gauge"></i></div>
            </article>
          </div>

          <div class="timeline" aria-label="Workout intervals">
            ${workout.map((interval) => `<i data-timeline-id="${interval.id}" style="flex:${interval.duration}" title="${escapeHtml(interval.name)}"></i>`).join("")}
          </div>
          <div class="time-row"><span id="elapsed-time">${formatTime(position)}</span><span>${formatTime(duration)}</span></div>
          <input class="scrubber" data-action="seek" aria-label="Workout position" type="range" min="0" max="${duration}" step="1" value="${Math.round(position)}" ${isPlaying ? "disabled" : ""}>

          <div class="transport">
            <button class="icon-button" data-action="previous" aria-label="Previous interval">←</button>
            <button class="play-button" data-action="toggle">${isPlaying ? "Pause" : completed ? "Ride again" : position > 0 ? "Resume" : "Start ride"}</button>
            <button class="icon-button" data-action="next" aria-label="Next interval">→</button>
            <button class="text-button" data-action="restart">Restart</button>
          </div>
          ${transportError ? `<p class="transport-error" role="alert">${escapeHtml(transportError)}</p>` : ""}
          <p class="next-up" id="next-up"></p>
        </section>

        <section class="editor-panel" aria-labelledby="editor-title">
          <div class="editor-heading"><div><p class="eyebrow">PROGRAM</p><h2 id="editor-title">Build your ride</h2></div><button class="text-button" data-action="reset-program" ${isPlaying ? "disabled" : ""}>Reset</button></div>
          <p class="editor-help">Set a start and end target to create a gradual ramp.</p>
          <div class="interval-list">
            ${workout.map((interval, index) => `
              <article class="interval-editor ${interval.id === activeIntervalId ? "is-active" : ""}">
                <div class="interval-editor-head"><span>${String(index + 1).padStart(2, "0")}</span><input class="name-input" aria-label="Interval ${index + 1} name" data-index="${index}" data-field="name" maxlength="40" value="${escapeHtml(interval.name)}" ${isPlaying ? "disabled" : ""}><div class="reorder"><button data-action="move-up" data-index="${index}" aria-label="Move ${escapeHtml(interval.name)} up" ${isPlaying || index === 0 ? "disabled" : ""}>↑</button><button data-action="move-down" data-index="${index}" aria-label="Move ${escapeHtml(interval.name)} down" ${isPlaying || index === workout.length - 1 ? "disabled" : ""}>↓</button><button data-action="remove" data-index="${index}" aria-label="Remove ${escapeHtml(interval.name)}" ${isPlaying || workout.length === 1 ? "disabled" : ""}>×</button></div></div>
                <div class="field-grid">
                  ${numberInput(index, "duration", interval.duration, 5, 120, "Duration", "sec")}
                  ${numberInput(index, "cadenceStart", interval.cadenceStart, 40, 140, "Cadence start", "RPM")}
                  ${numberInput(index, "cadenceEnd", interval.cadenceEnd, 40, 140, "Cadence end", "RPM")}
                  ${numberInput(index, "resistanceStart", interval.resistanceStart, 0, 100, "Resistance start", "%")}
                  ${numberInput(index, "resistanceEnd", interval.resistanceEnd, 0, 100, "Resistance end", "%")}
                </div>
              </article>`).join("")}
          </div>
          <button class="add-button" data-action="add" ${isPlaying || workout.length >= WORKOUT_LIMITS.maxSections ? "disabled" : ""}>+ Add interval</button>
        </section>
      </section>
    </main>`;
  updateLiveView();
}

function updateLiveView(): void {
  if (engine.getPlaybackState() === "playing") {
    position = Math.min(totalDuration(workout), engine.getPosition().beat);
  }
  const duration = totalDuration(workout);
  const current = intervalAt(Math.min(position, Math.max(0, duration - 0.001)));
  const channels = engine.sampleChannels();
  const cadence = Math.round(40 + (channels.cadence ?? 0) * 100);
  const resistance = Math.round((channels.resistance ?? 0) * 100);
  const intervalRemaining = Math.max(0, current.start + current.interval.duration - position);
  const next = workout[current.index + 1];

  const setText = (selector: string, value: string) => { const element = document.querySelector(selector); if (element) element.textContent = value; };
  setText("#interval-time", formatTime(intervalRemaining));
  setText("#elapsed-time", formatTime(position));
  setText("#cadence-value", String(cadence));
  setText("#resistance-value", String(resistance));
  setText("#next-up", next ? `Next: ${next.name} · ${formatTime(next.duration)}` : "Final interval");
  const cadenceGauge = document.querySelector<HTMLElement>("#cadence-gauge");
  const resistanceGauge = document.querySelector<HTMLElement>("#resistance-gauge");
  if (cadenceGauge) cadenceGauge.style.width = `${channels.cadence * 100}%`;
  if (resistanceGauge) resistanceGauge.style.width = `${channels.resistance * 100}%`;
  document.querySelectorAll<HTMLElement>("[data-timeline-id]").forEach((element) => element.classList.toggle("is-active", element.dataset.timelineId === current.interval.id));
  const scrubber = document.querySelector<HTMLInputElement>('[data-action="seek"]');
  if (scrubber && engine.getPlaybackState() === "playing") scrubber.value = String(position);
}

function startAnimation(): void {
  stopAnimation();
  const tick = () => {
    updateLiveView();
    if (engine.getPlaybackState() === "playing") animationFrame = requestAnimationFrame(tick);
  };
  animationFrame = requestAnimationFrame(tick);
}

function stopAnimation(): void {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = 0;
}

function rebuild(): void {
  stopAnimation();
  engine.dispose();
  position = 0;
  completed = false;
  activeIntervalId = workout[0].id;
  engine = createEngine();
  render();
}

function seekTo(seconds: number): void {
  position = Math.min(totalDuration(workout), Math.max(0, seconds));
  completed = position >= totalDuration(workout);
  runTransportCommand(() => engine.seekBeat(position));
  activeIntervalId = intervalAt(Math.min(position, totalDuration(workout) - 0.001)).interval.id;
  render();
}

app.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  const index = Number(button.dataset.index);

  if (action === "toggle") {
    if (engine.getPlaybackState() === "playing") {
      runTransportCommand(() => engine.pause());
    } else {
      if (completed) seekTo(0);
      runTransportCommand(() => engine.play());
    }
  } else if (action === "restart") seekTo(0);
  else if (action === "previous" || action === "next") {
    const current = intervalAt(Math.min(position, totalDuration(workout) - 0.001));
    const targetIndex = Math.min(workout.length - 1, Math.max(0, current.index + (action === "next" ? 1 : -1)));
    seekTo(workout.slice(0, targetIndex).reduce((sum, interval) => sum + interval.duration, 0));
  } else if (action === "reset-program") { workout = cloneInitialWorkout(); rebuild(); }
  else if (action === "add") {
    workout.push({ id: `custom-${nextId++}`, name: "New interval", duration: 30, cadenceStart: 80, cadenceEnd: 90, resistanceStart: 35, resistanceEnd: 45 });
    rebuild();
  } else if (action === "remove") { workout.splice(index, 1); rebuild(); }
  else if (action === "move-up" || action === "move-down") {
    const target = index + (action === "move-up" ? -1 : 1);
    [workout[index], workout[target]] = [workout[target], workout[index]];
    rebuild();
  }
});

app.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.dataset.action === "seek") { seekTo(Number(input.value)); return; }
  if (!input.dataset.field || input.dataset.index === undefined) return;
  const index = Number(input.dataset.index);
  const field = input.dataset.field as keyof WorkoutInterval;
  workout[index] = sanitizeInterval({ ...workout[index], [field]: field === "name" ? input.value : Number(input.value) });
  rebuild();
});

render();
