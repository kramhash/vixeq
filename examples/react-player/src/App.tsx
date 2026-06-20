import { SequencePlayer, type SequencePlayerRef } from "@vixeq/player-react";
import { clearTrack, createProject, randomizeTrack, rotateTrackSteps, type SequenceProject, type StepEvent } from "@vixeq/core";
import { useRef, useState } from "react";

const initialProject = (): SequenceProject =>
  createProject({ bpm: 118, stepCount: 16, trackCount: 3, trackNames: ["Gate", "Motion", "Accent"] });

export function App() {
  const playerRef = useRef<SequencePlayerRef>(null);
  const [project, setProject] = useState(initialProject);
  const [latestEvent, setLatestEvent] = useState<StepEvent | null>(null);

  const firstTrackId = project.tracks[0]?.id;

  return (
    <main className="shell">
      <header className="header">
        <div>
          <h1>React Player</h1>
          <p>Controlled SequencePlayer with external transport and project transforms.</p>
        </div>
        <div className="controls">
          <button type="button" onClick={() => playerRef.current?.play()}>
            Play
          </button>
          <button type="button" onClick={() => playerRef.current?.stop()}>
            Stop
          </button>
          <button type="button" onClick={() => playerRef.current?.reset(0)}>
            Reset
          </button>
        </div>
      </header>

      <div className="transform-controls">
        <button type="button" disabled={!firstTrackId} onClick={() => firstTrackId && setProject(clearTrack(project, firstTrackId))}>
          Clear first lane
        </button>
        <button
          type="button"
          disabled={!firstTrackId}
          onClick={() => firstTrackId && setProject(rotateTrackSteps(project, firstTrackId, -1))}
        >
          Rotate left
        </button>
        <button
          type="button"
          disabled={!firstTrackId}
          onClick={() => firstTrackId && setProject(rotateTrackSteps(project, firstTrackId, 1))}
        >
          Rotate right
        </button>
        <button
          type="button"
          disabled={!firstTrackId}
          onClick={() => firstTrackId && setProject(randomizeTrack(project, firstTrackId, { probability: 0.45, min: 0.25 }))}
        >
          Randomize first lane
        </button>
      </div>

      <SequencePlayer
        ref={playerRef}
        project={project}
        onProjectChange={({ project: nextProject }) => setProject(nextProject)}
        onStep={setLatestEvent}
      />

      <section className="event">
        <h2>Latest StepEvent</h2>
        <pre>{latestEvent ? JSON.stringify(latestEvent, null, 2) : "No step emitted yet."}</pre>
      </section>
    </main>
  );
}
