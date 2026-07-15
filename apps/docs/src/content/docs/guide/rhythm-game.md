---
title: "Tutorial: Build a rhythm game in React"
description: Build a one-button rhythm game with Vixeq timing, React input handling, and a pulsing visual cue.
---

This tutorial turns a Vixeq sequence into a tiny rhythm game: a ring pulses in
time, the player presses Space or a Tap button, and React scores the input
against the nearest pulse.

The game has no falling notes. Vixeq owns the rhythm grid and playback
position; your React code handles input, scoring, and UI.

## Install

```sh
npm install @vixeq/core @vixeq/react
```

## 1. Create the rhythm pattern

Use one Vixeq track as the source of truth for both the pulse animation and
the hit timing. A step value of `1` means "pulse here"; `0` means rest.

```tsx
import { createProject, setStepValue, type SequenceProject } from "@vixeq/core";

const PULSE_STEPS = [0, 2, 4, 7, 10, 12, 14];

const initialProject = (): SequenceProject => {
  let project = createProject({
    bpm: 120,
    stepCount: 16,
    stepsPerBeat: 4,
    trackCount: 1,
    trackNames: ["Pulse"],
  });

  const trackId = project.tracks[0].id;
  for (const step of PULSE_STEPS) {
    project = setStepValue(project, trackId, step, 1);
  }

  return project;
};
```

At `120` BPM with `stepsPerBeat: 4`, each step is a sixteenth note. The
project loops forever when played by `SequencerEngine`, so this 16-step pattern
becomes a repeating rhythm.

## 2. Play the sequence

`useSequencerEngine` creates and owns the engine. The returned `positionRef`
is important for a game: it gives the current playback position without
forcing React to re-render every animation frame.

```tsx
import { useSequencerEngine } from "@vixeq/react";
import { useState } from "react";

function RhythmGame() {
  const [project] = useState<SequenceProject>(initialProject);
  const player = useSequencerEngine({ project });

  return (
    <button type="button" onClick={() => void player.toggle()}>
      {player.playbackState === "playing" ? "Pause" : "Play"}
    </button>
  );
}
```

## 3. Drive the pulse animation

Envelope mode is a good fit for rhythm visuals. The engine emits a step event
at each scheduled step boundary, `useAnimatedChannels` passes the step value to
the envelope, and the animation frame loop writes the current envelope value to
CSS. A value of `1` excites the ring; a value of `0` lets it rest.

```tsx
import { createEnvelope, easeOutCubic } from "@vixeq/core";
import { bindChannelsToElement } from "@vixeq/core/dom";
import { useAnimatedChannels, useSequencerEngine } from "@vixeq/react";
import { useMemo, useRef, useState } from "react";

function RhythmGame() {
  const [project] = useState<SequenceProject>(initialProject);
  const trackId = project.tracks[0].id;
  const player = useSequencerEngine({ project });
  const stageRef = useRef<HTMLDivElement>(null);

  const envelopes = useMemo(
    () => ({
      [trackId]: createEnvelope({ decay: 180, curve: easeOutCubic }),
    }),
    [trackId],
  );

  useAnimatedChannels(player.engine, {
    envelopes,
    onFrame: (values) => {
      if (!stageRef.current) return;
      bindChannelsToElement(stageRef.current, values, { [trackId]: "--beat" });
    },
  });

  return <div ref={stageRef} className="rhythm-stage">{/* ... */}</div>;
}
```

Now CSS can turn `--beat` into a visual cue:

```css
.pulse-ring {
  width: 160px;
  aspect-ratio: 1;
  border: 3px solid hsl(178 78% 52%);
  border-radius: 50%;
  opacity: calc(0.35 + var(--beat, 0) * 0.65);
  transform: scale(calc(0.82 + var(--beat, 0) * 0.28));
  box-shadow: 0 0 calc(var(--beat, 0) * 44px) hsl(178 78% 52% / 0.75);
}
```

## 4. Judge player input

When the player taps, read `player.positionRef.current.positionMs`, find the
nearest pulse in the looping pattern, and score the timing error.

```tsx
const PERFECT_WINDOW_MS = 60;
const GOOD_WINDOW_MS = 110;

const getStepDurationMs = (project: SequenceProject) =>
  60_000 / project.bpm / project.stepsPerBeat;

const findNearestPulse = (positionMs: number, project: SequenceProject) => {
  const stepDurationMs = getStepDurationMs(project);
  const loopDurationMs = stepDurationMs * project.stepCount;
  const loopIndex = Math.floor(positionMs / loopDurationMs);

  let nearest = {
    stepIndex: PULSE_STEPS[0],
    hitId: `${loopIndex}:${PULSE_STEPS[0]}`,
    errorMs: Number.POSITIVE_INFINITY,
    absErrorMs: Number.POSITIVE_INFINITY,
  };

  for (const stepIndex of PULSE_STEPS) {
    for (const loopOffset of [-1, 0, 1]) {
      const candidateLoop = loopIndex + loopOffset;
      const pulseMs = candidateLoop * loopDurationMs + stepIndex * stepDurationMs;
      const errorMs = positionMs - pulseMs;
      const absErrorMs = Math.abs(errorMs);

      if (absErrorMs < nearest.absErrorMs) {
        nearest = {
          stepIndex,
          hitId: `${candidateLoop}:${stepIndex}`,
          errorMs,
          absErrorMs,
        };
      }
    }
  }

  return nearest;
};
```

The extra `loopOffset` checks make taps near the start or end of the loop
judge against the wrapped pulse correctly.

## 5. Add score, combo, and controls

Keep scoring in React state. Store the last successful `hitId` in a ref so one
pulse cannot be scored more than once.

```tsx
const [score, setScore] = useState(0);
const [combo, setCombo] = useState(0);
const [lastJudgment, setLastJudgment] = useState("Ready");
const lastHitRef = useRef<string | null>(null);

const handleTap = useCallback(() => {
  if (player.playbackState !== "playing") return;

  const nearest = findNearestPulse(player.positionRef.current.positionMs, project);

  if (nearest.absErrorMs <= GOOD_WINDOW_MS && nearest.hitId === lastHitRef.current) {
    return;
  }

  if (nearest.absErrorMs <= PERFECT_WINDOW_MS) {
    lastHitRef.current = nearest.hitId;
    setScore((value) => value + 100);
    setCombo((value) => value + 1);
    setLastJudgment("Perfect");
    return;
  }

  if (nearest.absErrorMs <= GOOD_WINDOW_MS) {
    lastHitRef.current = nearest.hitId;
    setScore((value) => value + 50);
    setCombo((value) => value + 1);
    setLastJudgment("Good");
    return;
  }

  setCombo(0);
  setLastJudgment("Miss");
}, [player.playbackState, player.positionRef, project]);
```

Wire the same handler to the Tap button and Space key:

```tsx
useEffect(() => {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "Space" || event.repeat) return;
    event.preventDefault();
    handleTap();
  };

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, [handleTap]);
```

## Full example

```tsx
import {
  createEnvelope,
  createProject,
  easeOutCubic,
  setStepValue,
  type SequenceProject,
} from "@vixeq/core";
import { bindChannelsToElement } from "@vixeq/core/dom";
import { useAnimatedChannels, useSequencerEngine } from "@vixeq/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const PULSE_STEPS = [0, 2, 4, 7, 10, 12, 14];
const PERFECT_WINDOW_MS = 60;
const GOOD_WINDOW_MS = 110;

const initialProject = (): SequenceProject => {
  let project = createProject({
    bpm: 120,
    stepCount: 16,
    stepsPerBeat: 4,
    trackCount: 1,
    trackNames: ["Pulse"],
  });

  const trackId = project.tracks[0].id;
  for (const step of PULSE_STEPS) {
    project = setStepValue(project, trackId, step, 1);
  }

  return project;
};

const getStepDurationMs = (project: SequenceProject) =>
  60_000 / project.bpm / project.stepsPerBeat;

const findNearestPulse = (positionMs: number, project: SequenceProject) => {
  const stepDurationMs = getStepDurationMs(project);
  const loopDurationMs = stepDurationMs * project.stepCount;
  const loopIndex = Math.floor(positionMs / loopDurationMs);

  let nearest = {
    stepIndex: PULSE_STEPS[0],
    hitId: `${loopIndex}:${PULSE_STEPS[0]}`,
    errorMs: Number.POSITIVE_INFINITY,
    absErrorMs: Number.POSITIVE_INFINITY,
  };

  for (const stepIndex of PULSE_STEPS) {
    for (const loopOffset of [-1, 0, 1]) {
      const candidateLoop = loopIndex + loopOffset;
      const pulseMs = candidateLoop * loopDurationMs + stepIndex * stepDurationMs;
      const errorMs = positionMs - pulseMs;
      const absErrorMs = Math.abs(errorMs);

      if (absErrorMs < nearest.absErrorMs) {
        nearest = {
          stepIndex,
          hitId: `${candidateLoop}:${stepIndex}`,
          errorMs,
          absErrorMs,
        };
      }
    }
  }

  return nearest;
};

export function RhythmGame() {
  const [project] = useState<SequenceProject>(initialProject);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [lastJudgment, setLastJudgment] = useState("Ready");
  const stageRef = useRef<HTMLDivElement>(null);
  const lastHitRef = useRef<string | null>(null);
  const trackId = project.tracks[0].id;

  const player = useSequencerEngine({ project });

  const envelopes = useMemo(
    () => ({
      [trackId]: createEnvelope({ decay: 180, curve: easeOutCubic }),
    }),
    [trackId],
  );

  useAnimatedChannels(player.engine, {
    envelopes,
    onFrame: (values) => {
      if (!stageRef.current) return;
      bindChannelsToElement(stageRef.current, values, { [trackId]: "--beat" });
    },
  });

  const handleTap = useCallback(() => {
    if (player.playbackState !== "playing") return;

    const nearest = findNearestPulse(player.positionRef.current.positionMs, project);

    if (nearest.absErrorMs <= GOOD_WINDOW_MS && nearest.hitId === lastHitRef.current) {
      return;
    }

    if (nearest.absErrorMs <= PERFECT_WINDOW_MS) {
      lastHitRef.current = nearest.hitId;
      setScore((value) => value + 100);
      setCombo((value) => value + 1);
      setLastJudgment("Perfect");
      return;
    }

    if (nearest.absErrorMs <= GOOD_WINDOW_MS) {
      lastHitRef.current = nearest.hitId;
      setScore((value) => value + 50);
      setCombo((value) => value + 1);
      setLastJudgment("Good");
      return;
    }

    setCombo(0);
    setLastJudgment("Miss");
  }, [player.playbackState, player.positionRef, project]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      event.preventDefault();
      handleTap();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleTap]);

  return (
    <div ref={stageRef} className="rhythm-game">
      <div className="hud">
        <span>Score {score}</span>
        <span>Combo {combo}</span>
        <strong>{lastJudgment}</strong>
      </div>

      <div className="pulse-wrap" aria-hidden="true">
        <div className="pulse-ring" />
        <div className="pulse-core" />
      </div>

      <div className="controls">
        <button type="button" onClick={() => void player.toggle()} disabled={player.isBusy}>
          {player.playbackState === "playing" ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={handleTap}
          disabled={player.playbackState !== "playing"}
        >
          Tap
        </button>
      </div>
    </div>
  );
}
```

```css
.rhythm-game {
  --beat: 0;
  display: grid;
  gap: 24px;
  justify-items: center;
  max-width: 420px;
  padding: 28px;
  color: hsl(220 24% 12%);
  background: hsl(190 38% 96%);
  border: 1px solid hsl(190 24% 82%);
  border-radius: 8px;
}

.hud {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
  align-items: center;
  text-align: center;
  font-size: 0.95rem;
}

.hud strong {
  color: hsl(330 72% 42%);
}

.pulse-wrap {
  position: relative;
  display: grid;
  place-items: center;
  width: min(58vw, 220px);
  aspect-ratio: 1;
}

.pulse-ring,
.pulse-core {
  grid-area: 1 / 1;
  border-radius: 50%;
}

.pulse-ring {
  width: 74%;
  aspect-ratio: 1;
  border: 3px solid hsl(178 78% 42%);
  opacity: calc(0.35 + var(--beat) * 0.65);
  transform: scale(calc(0.82 + var(--beat) * 0.28));
  box-shadow: 0 0 calc(var(--beat) * 44px) hsl(178 78% 42% / 0.7);
}

.pulse-core {
  width: 34%;
  aspect-ratio: 1;
  background: hsl(330 72% 52%);
  transform: scale(calc(0.9 + var(--beat) * 0.16));
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
}

.controls button {
  min-width: 96px;
  min-height: 44px;
  border: 0;
  border-radius: 6px;
  color: white;
  background: hsl(220 72% 36%);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.controls button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
```

## What Vixeq is doing

- The `SequenceProject` stores the rhythm pattern.
- `useSequencerEngine` plays that pattern on a stable timing grid.
- `useAnimatedChannels` converts active rhythm steps into a per-frame `--beat`
  value for CSS.
- `positionRef.current.positionMs` gives input code the same playback position
  that drives the animation.

From here, you can add more lanes by creating more tracks, map each track to
its own key, or replace the browser clock with an audio transport when the
game needs to sync to a song.
