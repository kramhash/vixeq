import {
  SEQUENCER_LIMITS,
  addTrack,
  createProject,
  removeTrack,
  renameTrack,
  setProjectBpm,
  setStepValue,
  setTrackEnabled,
  toggleStep,
  type SequenceProject,
  type SequencerClock,
  type SequencerEngine,
  type SequencerTransport,
  type StepEvent,
  type TransportEvent,
} from "@vixeq/core";
import { useSequencePlayer } from "@vixeq/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";

export type SelectedStep = {
  trackId: string;
  stepIndex: number;
};

export type SequencePlayerChangeReason =
  | "bpm"
  | "track:add"
  | "track:remove"
  | "track:rename"
  | "track:enabled"
  | "step:toggle"
  | "step:value"
  | "project:replace";

export type SequencePlayerProjectChange = {
  project: SequenceProject;
  reason: SequencePlayerChangeReason;
  trackId?: string;
  stepIndex?: number;
};

export type SequencePlayerTransportState = {
  currentStep: number;
  isPlaying: boolean;
  isStarting: boolean;
  latestEvent: StepEvent | null;
  transportError: unknown | null;
};

export type SequencePlayerRef = {
  play: () => Promise<void>;
  stop: () => Promise<void>;
  toggle: () => Promise<void>;
  reset: (stepIndex?: number) => Promise<void>;
};

type SequencePlayerBaseProps = {
  project: SequenceProject;
  onProjectChange: (change: SequencePlayerProjectChange) => void;
  onStep?: (event: StepEvent) => void;
  onTransportChange?: (event: TransportEvent) => void;
  onSelectedStepChange?: (selectedStep: SelectedStep | null) => void;
  /**
   * Called with the underlying SequencerEngine when it becomes available, and
   * with null when it is disposed (unmount or clock/transport change).
   * Pass the received engine to useAnimatedChannels for zero-re-render animation.
   */
  onEngineChange?: (engine: SequencerEngine | null) => void;
  timeDriven?: boolean;
  originMs?: number;
  showTransportControls?: boolean;
  className?: string;
  style?: CSSProperties;
};

export type SequencePlayerProps =
  | (SequencePlayerBaseProps & {
      clock?: SequencerClock;
      transport?: never;
    })
  | (SequencePlayerBaseProps & {
      clock?: never;
      transport: SequencerTransport;
    });

export type StandaloneSequencePlayerProps =
  | (Omit<SequencePlayerBaseProps, "project" | "onProjectChange"> & {
      defaultProject?: SequenceProject;
      onProjectChange?: (change: SequencePlayerProjectChange) => void;
      clock?: SequencerClock;
      transport?: never;
    })
  | (Omit<SequencePlayerBaseProps, "project" | "onProjectChange"> & {
      defaultProject?: SequenceProject;
      onProjectChange?: (change: SequencePlayerProjectChange) => void;
      clock?: never;
      transport: SequencerTransport;
    });

const formatValue = (value: number): string => value.toFixed(2);

const readPointerValue = (event: PointerEvent<HTMLElement>): number => {
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = 1 - (event.clientY - rect.top) / rect.height;
  return Math.min(1, Math.max(0, ratio));
};

export const SequencePlayer = forwardRef<SequencePlayerRef, SequencePlayerProps>(function SequencePlayer(
  {
    project,
    onProjectChange,
    onStep,
    onTransportChange,
    onSelectedStepChange,
    onEngineChange,
    clock,
    transport,
    timeDriven,
    originMs,
    showTransportControls = true,
    className,
    style,
  },
  ref,
) {
  const [selected, setSelected] = useState<SelectedStep | null>(null);
  const draggingRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number; trackId: string; stepIndex: number } | null>(null);
  const player = useSequencePlayer(
    transport
      ? {
          project,
          onStep,
          onTransportChange,
          transport,
          timeDriven,
          originMs,
        }
      : {
          project,
          onStep,
          onTransportChange,
          clock,
          timeDriven,
          originMs,
        },
  );

  useImperativeHandle(
    ref,
    () => ({
      play: player.play,
      stop: player.stop,
      toggle: player.toggle,
      reset: player.reset,
    }),
    [player.play, player.reset, player.stop, player.toggle],
  );

  // Forward the engine instance to the caller so they can pass it to
  // useAnimatedChannels for zero-re-render animation via direct subscription.
  useEffect(() => {
    onEngineChange?.(player.engine);
    return () => { onEngineChange?.(null); };
  }, [player.engine, onEngineChange]);

  const updateSelected = useCallback(
    (nextSelected: SelectedStep | null) => {
      setSelected(nextSelected);
      onSelectedStepChange?.(nextSelected);
    },
    [onSelectedStepChange],
  );

  const commitProject = useCallback(
    (change: SequencePlayerProjectChange) => {
      onProjectChange(change);
    },
    [onProjectChange],
  );

  const updateStepFromPointer = (
    event: PointerEvent<HTMLButtonElement>,
    trackId: string,
    stepIndex: number,
    baseProject = project,
  ) => {
    updateSelected({ trackId, stepIndex });
    commitProject({
      project: setStepValue(baseProject, trackId, stepIndex, readPointerValue(event)),
      reason: "step:value",
      trackId,
      stepIndex,
    });
  };

  const selectedTrack = selected ? project.tracks.find((track) => track.id === selected.trackId) : undefined;
  const selectedValue = selectedTrack && selected ? selectedTrack.steps[selected.stepIndex] : undefined;
  const rootClassName = ["vixeq-player", className].filter(Boolean).join(" ");

  return (
    <section
      className={rootClassName}
      style={{ ...style, "--vixeq-step-count": project.stepCount } as CSSProperties}
      data-playing={player.isPlaying ? "true" : "false"}
    >
      <header className="vixeq-player__transport">
        {showTransportControls && (
          <div className="vixeq-player__transport-main">
            <button
              className="vixeq-player__play"
              type="button"
              disabled={player.isStarting}
              onClick={() => {
                void player.toggle();
              }}
            >
              {player.isStarting ? "Starting..." : player.isPlaying ? "Stop" : "Play"}
            </button>
            <button
              type="button"
              disabled={player.isStarting}
              onClick={() => {
                void player.reset(0);
              }}
            >
              Reset
            </button>
            <label className="vixeq-player__number-field">
              BPM
              <input
                min={SEQUENCER_LIMITS.minBpm}
                max={SEQUENCER_LIMITS.maxBpm}
                step={1}
                type="number"
                value={project.bpm}
                onChange={(event) =>
                  commitProject({
                    project: setProjectBpm(project, Number(event.target.value)),
                    reason: "bpm",
                  })
                }
              />
            </label>
          </div>
        )}
        <div className="vixeq-player__readout">
          <span>Step {player.currentStep + 1}</span>
          <span>{project.stepCount} Steps</span>
          <span>{project.tracks.length} Lanes</span>
        </div>
      </header>
      {player.transportError !== null && (
        <p className="vixeq-player__error" role="alert">
          Transport failed. Check the audio source and browser playback permission.
        </p>
      )}

      <div className="vixeq-player__body">
        <div className="vixeq-player__grid-shell">
          <div className="vixeq-player__grid-header">
            <div className="vixeq-player__track-heading">
              <button
                type="button"
                onClick={() =>
                  commitProject({
                    project: addTrack(project, `Lane ${project.tracks.length + 1}`),
                    reason: "track:add",
                  })
                }
                disabled={project.tracks.length >= SEQUENCER_LIMITS.maxTracks}
              >
                Add Lane
              </button>
            </div>
            <div className="vixeq-player__step-heading">
              {Array.from({ length: project.stepCount }, (_, index) => (
                <span key={index} className={index === player.currentStep ? "is-active" : ""}>
                  {index + 1}
                </span>
              ))}
            </div>
          </div>

          <div className="vixeq-player__track-list">
            {project.tracks.map((track) => (
              <div className="vixeq-player__track-row" key={track.id}>
                <div className="vixeq-player__track-meta">
                  <input
                    aria-label={`${track.name} name`}
                    value={track.name}
                    onChange={(event) =>
                      commitProject({
                        project: renameTrack(project, track.id, event.target.value),
                        reason: "track:rename",
                        trackId: track.id,
                      })
                    }
                  />
                  <label className="vixeq-player__enable-toggle">
                    <input
                      checked={track.enabled}
                      type="checkbox"
                      onChange={(event) =>
                        commitProject({
                          project: setTrackEnabled(project, track.id, event.target.checked),
                          reason: "track:enabled",
                          trackId: track.id,
                        })
                      }
                    />
                    On
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      commitProject({
                        project: removeTrack(project, track.id),
                        reason: "track:remove",
                        trackId: track.id,
                      })
                    }
                    disabled={project.tracks.length <= SEQUENCER_LIMITS.minTracks}
                  >
                    Remove
                  </button>
                </div>
                <div className="vixeq-player__step-grid">
                  {track.steps.map((value, stepIndex) => {
                    const isSelected = selected?.trackId === track.id && selected?.stepIndex === stepIndex;
                    const isCurrent = player.currentStep === stepIndex;

                    return (
                      <button
                        className={[
                          "vixeq-player__step-cell",
                          isSelected ? "is-selected" : "",
                          isCurrent ? "is-current" : "",
                        ].join(" ")}
                        key={`${track.id}-${stepIndex}`}
                        style={{ "--vixeq-step-value": value } as CSSProperties}
                        type="button"
                        title={`${track.name} step ${stepIndex + 1}: ${formatValue(value)}`}
                        onClick={() => {
                          if (draggingRef.current) {
                            draggingRef.current = false;
                            return;
                          }
                          updateSelected({ trackId: track.id, stepIndex });
                          commitProject({
                            project: toggleStep(project, track.id, stepIndex),
                            reason: "step:toggle",
                            trackId: track.id,
                            stepIndex,
                          });
                        }}
                        onPointerDown={(event) => {
                          event.currentTarget.setPointerCapture(event.pointerId);
                          draggingRef.current = false;
                          pointerStartRef.current = {
                            x: event.clientX,
                            y: event.clientY,
                            trackId: track.id,
                            stepIndex,
                          };
                        }}
                        onPointerMove={(event) => {
                          const start = pointerStartRef.current;
                          if (!start) {
                            return;
                          }

                          if (
                            event.buttons === 1 &&
                            start.trackId === track.id &&
                            start.stepIndex === stepIndex &&
                            (draggingRef.current ||
                              Math.abs(event.clientY - start.y) > 3 ||
                              Math.abs(event.clientX - start.x) > 3)
                          ) {
                            draggingRef.current = true;
                            updateStepFromPointer(event, track.id, stepIndex);
                          }
                        }}
                        onPointerUp={() => {
                          pointerStartRef.current = null;
                          window.setTimeout(() => {
                            draggingRef.current = false;
                          }, 0);
                        }}
                      >
                        <span className="vixeq-player__value-bar" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="vixeq-player__inspector">
          <h2>Step</h2>
          {selected && selectedTrack && selectedValue !== undefined ? (
            <div className="vixeq-player__inspector-fields">
              <span>{selectedTrack.name}</span>
              <span>Step {selected.stepIndex + 1}</span>
              <label>
                Value
                <input
                  max={1}
                  min={0}
                  step={0.01}
                  type="number"
                  value={formatValue(selectedValue)}
                  onChange={(event) =>
                    commitProject({
                      project: setStepValue(project, selected.trackId, selected.stepIndex, Number(event.target.value)),
                      reason: "step:value",
                      trackId: selected.trackId,
                      stepIndex: selected.stepIndex,
                    })
                  }
                />
              </label>
              <input
                aria-label="Step value"
                max={1}
                min={0}
                step={0.01}
                type="range"
                value={selectedValue}
                onChange={(event) =>
                  commitProject({
                    project: setStepValue(project, selected.trackId, selected.stepIndex, Number(event.target.value)),
                    reason: "step:value",
                    trackId: selected.trackId,
                    stepIndex: selected.stepIndex,
                  })
                }
              />
              <button
                type="button"
                onClick={() =>
                  commitProject({
                    project: setStepValue(project, selected.trackId, selected.stepIndex, 0),
                    reason: "step:value",
                    trackId: selected.trackId,
                    stepIndex: selected.stepIndex,
                  })
                }
              >
                Clear Step
              </button>
            </div>
          ) : (
            <p>Select a step to edit its value.</p>
          )}
        </aside>
      </div>
    </section>
  );
});

export const StandaloneSequencePlayer = forwardRef<SequencePlayerRef, StandaloneSequencePlayerProps>(
  function StandaloneSequencePlayer({ defaultProject, onProjectChange, ...props }, ref) {
    const [project, setProject] = useState(() => defaultProject ?? createProject({ trackNames: ["Lane 1", "Lane 2", "Lane 3", "Lane 4"] }));
    const nextProps = {
      ...props,
      ref,
      project,
      onProjectChange: (change: SequencePlayerProjectChange) => {
        setProject(change.project);
        onProjectChange?.(change);
      },
    } as SequencePlayerProps & { ref: typeof ref };

    return <SequencePlayer {...nextProps} />;
  },
);
