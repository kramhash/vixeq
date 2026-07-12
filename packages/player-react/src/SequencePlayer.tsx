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

/** A single addressable step: which track it belongs to and its index within that track's steps. */
export type SelectedStep = {
  trackId: string;
  stepIndex: number;
};

/**
 * Discriminates why a {@link SequencePlayerProjectChange} fired, so a consumer can persist,
 * batch, or selectively react to edits without diffing the whole project.
 *
 * `"project:replace"` is reserved for callers that swap in an entirely new project themselves;
 * `SequencePlayer` never dispatches it internally (all edits from its own UI report one of the
 * other, more specific reasons).
 */
export type SequencePlayerChangeReason =
  | "bpm"
  | "track:add"
  | "track:remove"
  | "track:rename"
  | "track:enabled"
  | "step:toggle"
  | "step:value"
  | "project:replace";

/**
 * Payload passed to {@link SequencePlayerProps.onProjectChange} for every edit made through the
 * player's UI (BPM field, add/remove/rename/enable a track, click or drag a step's value).
 *
 * `trackId` is present for track- and step-level reasons ("track:remove", "track:rename",
 * "track:enabled", "step:toggle", "step:value"); `stepIndex` is present only for the step-level
 * reasons ("step:toggle", "step:value"). Both are omitted for "bpm" and "track:add".
 */
export type SequencePlayerProjectChange = {
  project: SequenceProject;
  reason: SequencePlayerChangeReason;
  trackId?: string;
  stepIndex?: number;
};

/**
 * Shape of the live transport/engine state produced by the `useSequencePlayer` hook (from
 * `@vixeq/react`), mirrored here for consumers who want to build their own transport UI instead
 * of relying on the built-in bar that {@link SequencePlayer} renders when
 * `showTransportControls` is true.
 */
export type SequencePlayerTransportState = {
  playbackState: PlaybackState;
  positionRef: MutableRefObject<ChannelPosition>;
  pendingOperation: SequencerEnginePendingOperation | null;
  isBusy: boolean;
  latestEventRef: MutableRefObject<SequencerEngineLatestEvent | null>;
  projectError: Error | null;
  transportError: unknown | null;
};

/**
 * Imperative handle exposed via `ref` on {@link SequencePlayer} / {@link StandaloneSequencePlayer}.
 * Every method proxies to the underlying `SequencerEngine`/`PlaybackTransport` through the
 * `useSequencePlayer` command queue, so calls made in quick succession are serialized rather than
 * racing each other.
 */
export type SequencePlayerRef = {
  /** Start (or resume) playback. */
  play: () => Promise<void>;
  /** Pause playback, retaining the current transport position. */
  pause: () => Promise<void>;
  /** Stop playback and reset the transport position. */
  stop: () => Promise<void>;
  /** Pause if currently playing, otherwise play. */
  toggle: () => Promise<void>;
  /** Seek playback to a specific step index. */
  seekStep: (stepIndex: number) => Promise<void>;
  /** Seek playback to a specific transport position, in milliseconds. */
  seekPositionMs: (positionMs: number) => Promise<void>;
  /** Change the playback rate (1 = normal speed). */
  setPlaybackRate: (rate: number) => Promise<void>;
  /** Enable or disable transport looping. */
  setTransportLoop: (loop: boolean) => Promise<void>;
};

/**
 * Shared prop surface between {@link SequencePlayer} (controlled) and
 * {@link StandaloneSequencePlayer} (uncontrolled, see {@link StandaloneSequencePlayerProps}).
 */
type SequencePlayerBaseProps = {
  /**
   * The project to render and play. The player is fully controlled: it never mutates `project`
   * in place, so this should be the same value most recently reported via `onProjectChange`
   * (or the initial project on first render).
   */
  project: SequenceProject;
  /**
   * Called whenever the player produces an edited project — from the BPM field, the track
   * add/remove/rename/enable controls, or clicking/dragging a step cell. The component does not
   * update itself; the caller must store `change.project` and pass it back in as `project`
   * (see the `@example` on {@link SequencePlayer}).
   */
  onProjectChange: (change: SequencePlayerProjectChange) => void;
  /**
   * Fired on every sequencer step boundary during playback (the underlying `SequencerEngine`'s
   * `"step"` event). Use for lightweight, beat-synced side effects outside of React state.
   */
  onStep?: (event: StepEvent) => void;
  /**
   * Fired on transport/playback state changes (play, pause, stop, seek, rate/loop change,
   * buffering, end, error) reported by the underlying `SequencerEngine`.
   */
  onPlaybackChange?: (event: SequencerPlaybackEvent) => void;
  /**
   * Fired whenever the selected step cell changes, either from a click or programmatically;
   * `null` when the selection is cleared.
   */
  onSelectedStepChange?: (selectedStep: SelectedStep | null) => void;
  /**
   * Called with the underlying SequencerEngine when it becomes available, and
   * with null when it is disposed (unmount or transport/project lifecycle change).
   * Pass the received engine to useAnimatedChannels for zero-re-render animation.
   */
  onEngineChange?: (engine: SequencerEngine | null) => void;
  /**
   * Optional external `PlaybackTransport` to drive playback timing (e.g. synced to an audio or
   * video element). When omitted, the engine drives its own internal clock.
   */
  transport?: PlaybackTransport;
  /**
   * Whether to render the built-in Play/Stop/BPM transport bar. Defaults to `true`; set to
   * `false` to render only the step grid and inspector and drive playback via `ref` instead
   * ({@link SequencePlayerRef}).
   */
  showTransportControls?: boolean;
  /** Extra class name(s) appended to the root `<section>` element, alongside `"vixeq-player"`. */
  className?: string;
  /** Inline styles applied to the root `<section>` element (merged with the internal `--vixeq-step-count` custom property). */
  style?: CSSProperties;
};

/** Props for {@link SequencePlayer}, documented on each field above. */
export type SequencePlayerProps = SequencePlayerBaseProps;

/**
 * Props for {@link StandaloneSequencePlayer}. Identical to {@link SequencePlayerProps} except
 * `project`/`onProjectChange` are replaced by an optional uncontrolled `defaultProject` (used
 * once to seed internal state) and an optional `onProjectChange` observer callback.
 */
export type StandaloneSequencePlayerProps = Omit<SequencePlayerBaseProps, "project" | "onProjectChange"> & {
  /**
   * Initial project used to seed the component's internal state on mount (read once via a lazy
   * `useState` initializer — later changes to this prop are ignored). Defaults to a 4-lane empty
   * project created with `createProject`.
   */
  defaultProject?: SequenceProject;
  /**
   * Optional observer invoked after every edit, in addition to the component updating its own
   * internal project state. Unlike {@link SequencePlayerProps.onProjectChange}, this does not
   * need to write the project back anywhere — it is notification-only.
   */
  onProjectChange?: (change: SequencePlayerProjectChange) => void;
};

const formatValue = (value: number): string => value.toFixed(2);

/**
 * Derives the currently playing step index for the grid/readout highlight.
 * Sourced from the component's own `onStep`-tracked state (see
 * `latestStep` below) rather than the hook's `latestEventRef`, since a ref
 * mutation does not itself schedule a re-render — {@link SequencePlayer}
 * needs a repaint on every step, so it tracks step events into local state
 * instead of reading the ref during render.
 */
const deriveCurrentStep = (
  project: SequenceProject,
  latestStep: StepEvent | null,
  position: ChannelPosition,
): number => {
  const stepCount = Math.max(1, project.stepCount);
  if (latestStep !== null) {
    return ((latestStep.stepIndex % stepCount) + stepCount) % stepCount;
  }

  const stepDurationMs = 60_000 / project.bpm / project.stepsPerBeat;
  return Math.min(stepCount - 1, Math.max(0, Math.floor(position.positionMs / stepDurationMs) % stepCount));
};

const readPointerValue = (event: PointerEvent<HTMLElement>): number => {
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = 1 - (event.clientY - rect.top) / rect.height;
  return Math.min(1, Math.max(0, ratio));
};

/**
 * Editable, controlled React GUI for a {@link SequenceProject}: a per-track step grid, a value
 * inspector for the selected step, and (optionally) a built-in transport bar (Play/Pause, Stop,
 * BPM). Playback is driven by the `useSequencePlayer` hook from `@vixeq/react`, so scheduling,
 * position tracking, and the step/playback event stream all come from a real `SequencerEngine`
 * rather than being simulated in the UI.
 *
 * The component never mutates `project` in place. Every edit — BPM change, add/remove/rename/
 * enable a track, click or drag a step's value — is reported via `onProjectChange`, and the
 * caller is expected to feed the updated project back in as the `project` prop. Attach a `ref`
 * ({@link SequencePlayerRef}) to drive playback imperatively (e.g. from external transport UI,
 * keyboard shortcuts, or tests) independently of the built-in transport bar.
 *
 * @example
 * ```tsx
 * function Editor() {
 *   const [project, setProject] = useState(() =>
 *     createProject({ trackNames: ["Kick", "Snare"] }),
 *   );
 *
 *   return (
 *     <SequencePlayer
 *       project={project}
 *       onProjectChange={(change) => setProject(change.project)}
 *     />
 *   );
 * }
 * ```
 */
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
  const [latestStep, setLatestStep] = useState<StepEvent | null>(null);
  const draggingRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number; trackId: string; stepIndex: number } | null>(null);
  const handleStep = useCallback(
    (event: StepEvent) => {
      setLatestStep(event);
      onStep?.(event);
    },
    [onStep],
  );
  const handlePlaybackChange = useCallback(
    (event: SequencerPlaybackEvent) => {
      // stop() resets the engine's step position but emits no "step" event, so the
      // step-grid/readout highlight must be reset here too, or it stays frozen on the
      // last-played step instead of following the transport back to position 0.
      if (event.type === "stop") {
        setLatestStep(null);
      }
      onPlaybackChange?.(event);
    },
    [onPlaybackChange],
  );
  const player = useSequencePlayer({ project, onStep: handleStep, onPlaybackChange: handlePlaybackChange, transport });
  const currentStep = deriveCurrentStep(project, latestStep, player.positionRef.current);
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

/**
 * Uncontrolled convenience wrapper around {@link SequencePlayer}: it owns the `project` state
 * itself (seeded once from `defaultProject`, or a default 4-lane project) instead of requiring
 * the host to store it. Every edit updates that internal state automatically; the optional
 * `onProjectChange` prop is still invoked afterward, purely as an observer.
 *
 * Reach for this when you just want a working player without wiring up controlled state; use
 * {@link SequencePlayer} directly when the host application needs to own or persist the project
 * (e.g. save to disk, undo/redo, sync across clients).
 */
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
