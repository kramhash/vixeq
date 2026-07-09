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
  type ChannelPosition,
  type PlaybackState,
  type PlaybackTransport,
  type SequenceProject,
  type SequencerEngine,
  type SequencerPlaybackEvent,
  type StepEvent,
} from "@vixeq/core";
import { useSequencePlayer, type SequencerEngineLatestEvent, type SequencerEnginePendingOperation } from "@vixeq/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
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
  playbackState: PlaybackState;
  positionRef: MutableRefObject<ChannelPosition>;
  pendingOperation: SequencerEnginePendingOperation | null;
  isBusy: boolean;
  latestEvent: SequencerEngineLatestEvent | null;
  projectError: Error | null;
  transportError: unknown | null;
};

export type SequencePlayerRef = {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  toggle: () => Promise<void>;
  seekStep: (stepIndex: number) => Promise<void>;
  seekPositionMs: (positionMs: number) => Promise<void>;
  setPlaybackRate: (rate: number) => Promise<void>;
  setTransportLoop: (loop: boolean) => Promise<void>;
};

type SequencePlayerBaseProps = {
  project: SequenceProject;
  onProjectChange: (change: SequencePlayerProjectChange) => void;
  onStep?: (event: StepEvent) => void;
  onPlaybackChange?: (event: SequencerPlaybackEvent) => void;
  onSelectedStepChange?: (selectedStep: SelectedStep | null) => void;
  /**
   * Called with the underlying SequencerEngine when it becomes available, and
   * with null when it is disposed (unmount or transport/project lifecycle change).
   * Pass the received engine to useAnimatedChannels for zero-re-render animation.
   */
  onEngineChange?: (engine: SequencerEngine | null) => void;
  transport?: PlaybackTransport;
  showTransportControls?: boolean;
  className?: string;
  style?: CSSProperties;
};

export type SequencePlayerProps = SequencePlayerBaseProps;

export type StandaloneSequencePlayerProps = Omit<SequencePlayerBaseProps, "project" | "onProjectChange"> & {
  defaultProject?: SequenceProject;
  onProjectChange?: (change: SequencePlayerProjectChange) => void;
};

const formatValue = (value: number): string => value.toFixed(2);

const hasStepIndex = (event: SequencerEngineLatestEvent | null): event is StepEvent | Extract<SequencerEngineLatestEvent, { stepIndex: number }> =>
  event !== null && "stepIndex" in event;

const deriveCurrentStep = (
  project: SequenceProject,
  latestEvent: SequencerEngineLatestEvent | null,
  position: ChannelPosition,
): number => {
  const stepCount = Math.max(1, project.stepCount);
  if (hasStepIndex(latestEvent)) {
    return ((latestEvent.stepIndex % stepCount) + stepCount) % stepCount;
  }
  if (latestEvent && "snapshot" in latestEvent && "stepIndex" in latestEvent.snapshot) {
    return ((latestEvent.snapshot.stepIndex % stepCount) + stepCount) % stepCount;
  }

  const stepDurationMs = 60_000 / project.bpm / project.stepsPerBeat;
  return Math.min(stepCount - 1, Math.max(0, Math.floor(position.positionMs / stepDurationMs) % stepCount));
};

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
    onPlaybackChange,
    onSelectedStepChange,
    onEngineChange,
    transport,
    showTransportControls = true,
    className,
    style,
  },
  ref,
) {
  const [selected, setSelected] = useState<SelectedStep | null>(null);
  const draggingRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number; trackId: string; stepIndex: number } | null>(null);
  const player = useSequencePlayer({ project, onStep, onPlaybackChange, transport });
  const currentStep = deriveCurrentStep(project, player.latestEvent, player.positionRef.current);
  const isPlaying = player.playbackState === "playing";
  const primaryLabel = player.pendingOperation
    ? "Working..."
    : isPlaying
      ? "Pause"
      : player.positionRef.current.positionMs > 0
        ? "Resume"
        : "Play";

  useImperativeHandle(
    ref,
    () => ({
      play: player.play,
      pause: player.pause,
      stop: player.stop,
      toggle: player.toggle,
      seekStep: player.seekStep,
      seekPositionMs: player.seekPositionMs,
      setPlaybackRate: player.setPlaybackRate,
      setTransportLoop: player.setTransportLoop,
    }),
    [
      player.pause,
      player.play,
      player.seekPositionMs,
      player.seekStep,
      player.setPlaybackRate,
      player.setTransportLoop,
      player.stop,
      player.toggle,
    ],
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
      data-playing={isPlaying ? "true" : "false"}
    >
      <header className="vixeq-player__transport">
        {showTransportControls && (
          <div className="vixeq-player__transport-main">
            <button
              className="vixeq-player__play"
              type="button"
              disabled={player.isBusy}
              onClick={() => {
                void player.toggle().catch(() => undefined);
              }}
            >
              {primaryLabel}
            </button>
            <button
              type="button"
              disabled={player.isBusy}
              onClick={() => {
                void player.stop().catch(() => undefined);
              }}
            >
              Stop
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
          <span>Step {currentStep + 1}</span>
          <span>{project.stepCount} Steps</span>
          <span>{project.tracks.length} Lanes</span>
        </div>
      </header>
      {player.projectError !== null && (
        <p className="vixeq-player__error" role="alert">
          Project failed to load. Check the sequence data.
        </p>
      )}
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
                <span key={index} className={index === currentStep ? "is-active" : ""}>
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
                    const isCurrent = currentStep === stepIndex;

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
