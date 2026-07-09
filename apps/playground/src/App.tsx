import { SequencePlayer, type SelectedStep } from "@vixeq/player-react";
import { createProject, normalizeProject, presets, validateProject, type SequenceProject, type StepEvent } from "@vixeq/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Visualizer } from "./Visualizer";
import { loadStoredProject, saveStoredProject, type ProjectStorageLoadResult } from "./projectStorage";
import { createVisualizerState } from "./visualizerState";

const DEFAULT_TRACK_NAMES = ["Kick / Energy", "Depth / Motion", "Glow / Accent", "Color Shift"];

const createInitialProject = (): SequenceProject => createProject({ trackNames: DEFAULT_TRACK_NAMES });

const getBrowserStorage = (): Storage | undefined =>
  typeof window === "undefined" ? undefined : window.localStorage;

const getInitialProject = (): { project: SequenceProject; loadResult: ProjectStorageLoadResult } => {
  const loadResult = loadStoredProject(getBrowserStorage());
  return {
    project: loadResult.project ?? createInitialProject(),
    loadResult,
  };
};

export function App() {
  const [initialProject] = useState(getInitialProject);
  const [project, setProject] = useState<SequenceProject>(initialProject.project);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selected, setSelected] = useState<SelectedStep | null>(null);
  const [latestEvent, setLatestEvent] = useState<StepEvent | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [importError, setImportError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [storageStatus, setStorageStatus] = useState<ProjectStorageLoadResult["status"] | "saved">(
    initialProject.loadResult.status,
  );
  const skippedIgnoredStorageSaveRef = useRef(false);

  const presetEntries = useMemo(() => Object.entries(presets), []);
  const visualizerState = useMemo(
    () =>
      createVisualizerState({
        project,
        latestEvent,
        selected,
        isPlaying,
      }),
    [isPlaying, latestEvent, project, selected],
  );

  useEffect(() => {
    if (initialProject.loadResult.status === "ignored" && !skippedIgnoredStorageSaveRef.current) {
      skippedIgnoredStorageSaveRef.current = true;
      return;
    }

    setStorageStatus(saveStoredProject(getBrowserStorage(), project));
  }, [initialProject.loadResult.status, project]);

  const createNewProject = () => {
    if (dirty && !window.confirm("Start a new project?")) {
      return;
    }

    setProject(createInitialProject());
    setSelected(null);
    setLatestEvent(null);
    setJsonText("");
    setImportError("");
    setDirty(false);
  };

  const applyPreset = (presetName: string) => {
    const preset = presets[presetName];
    if (!preset) {
      return;
    }

    if (dirty && !window.confirm("Replace the current project with this preset?")) {
      return;
    }

    setProject(normalizeProject(preset));
    setSelected(null);
    setDirty(false);
    setImportError("");
  };

  const importJson = () => {
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      const result = validateProject(parsed);
      if (!result.ok) {
        setImportError(result.errors.map((error) => `${error.path}: ${error.message}`).join("\n"));
        return;
      }

      if (dirty && !window.confirm("Replace the current project with imported JSON?")) {
        return;
      }

      setProject(normalizeProject(parsed));
      setSelected(null);
      setDirty(false);
      setImportError("");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Invalid JSON.");
    }
  };

  const exportJson = () => {
    setJsonText(JSON.stringify(project, null, 2));
    setImportError("");
  };

  const storageLabel =
    storageStatus === "unavailable"
      ? "Local save unavailable"
      : storageStatus === "ignored"
        ? "Saved project ignored"
        : "Saved locally";

  return (
    <main className="app-shell">
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <h1>Vixeq</h1>
            <p>0-1 control sequencer</p>
          </div>
        </div>

        <div className="data-controls">
          <button type="button" onClick={createNewProject}>
            New
          </button>
          <select defaultValue="" aria-label="Preset" onChange={(event) => applyPreset(event.target.value)}>
            <option value="" disabled>
              Preset
            </option>
            {presetEntries.map(([name]) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button type="button" onClick={exportJson}>
            Export
          </button>
          <button type="button" onClick={importJson}>
            Import
          </button>
          <span className="storage-status">{storageLabel}</span>
        </div>
      </header>

      <section className="workspace">
        <div className="playground-main">
          <Visualizer state={visualizerState} />
          <SequencePlayer
            project={project}
            onProjectChange={({ project: nextProject }) => {
              setProject(nextProject);
              setDirty(true);
            }}
            onSelectedStepChange={setSelected}
            onStep={setLatestEvent}
            onPlaybackChange={(event) => {
              setIsPlaying(event.snapshot.state === "playing");
            }}
          />
        </div>

        <aside className="playground-inspector">
          <section>
            <h2>JSON</h2>
            <textarea
              value={jsonText}
              onChange={(event) => {
                setJsonText(event.target.value);
                setImportError("");
              }}
              spellCheck={false}
            />
            {importError ? <pre className="error-box">{importError}</pre> : null}
          </section>

          <section>
            <h2>Latest StepEvent</h2>
            <pre className="event-box">{latestEvent ? JSON.stringify(latestEvent, null, 2) : "No step emitted yet."}</pre>
          </section>
        </aside>
      </section>
    </main>
  );
}
