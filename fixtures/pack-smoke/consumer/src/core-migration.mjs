import { readFile } from "node:fs/promises";
import {
  migrateArrangementProject,
  migrateTimelineProject,
  validateArrangement,
  validateTimelineProject,
} from "@vixeq/core";

const fixtures = JSON.parse(
  await readFile(new URL("./migration-v1-to-v2.json", import.meta.url), "utf8"),
);

const assertOk = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const timelineResult = migrateTimelineProject(
  fixtures.timeline.valid.project,
  fixtures.timeline.valid.options,
);

assertOk(timelineResult.ok, "Expected packed Timeline migration fixture to succeed.");
assertOk(
  timelineResult.ok && validateTimelineProject(timelineResult.project).ok,
  "Expected packed Timeline migration output to validate.",
);
assertOk(
  timelineResult.ok && timelineResult.project.events[0].trackId === null,
  "Expected packed Timeline migration to rewrite global trackId to null.",
);

const timelineWarningResult = migrateTimelineProject(
  fixtures.timeline.removedFields.project,
  fixtures.timeline.removedFields.options,
);

assertOk(timelineWarningResult.ok, "Expected packed Timeline warning fixture to succeed.");
assertOk(
  timelineWarningResult.ok &&
    fixtures.timeline.removedFields.warningCodes.every((code) =>
      timelineWarningResult.warnings.some((warning) => warning.code === code),
    ),
  "Expected packed Timeline migration to report removed-field warnings.",
);

const timelineInvalidResult = migrateTimelineProject(
  fixtures.timeline.invalidOffset.project,
  fixtures.timeline.invalidOffset.options,
);

assertOk(!timelineInvalidResult.ok, "Expected packed Timeline invalid fixture to fail.");
assertOk(
  !timelineInvalidResult.ok &&
    fixtures.timeline.invalidOffset.errorCodes.every((code) =>
      timelineInvalidResult.errors.some((error) => error.code === code),
    ),
  "Expected packed Timeline migration to report invalid offset errors.",
);

const arrangementResult = migrateArrangementProject(
  fixtures.arrangement.valid.project,
  fixtures.arrangement.valid.options,
);

assertOk(arrangementResult.ok, "Expected packed Arrangement migration fixture to succeed.");
assertOk(
  arrangementResult.ok && validateArrangement(arrangementResult.project).ok,
  "Expected packed Arrangement migration output to validate.",
);
assertOk(
  arrangementResult.ok && arrangementResult.project.timing.tempos[0].bpm === fixtures.arrangement.valid.project.bpm,
  "Expected packed Arrangement migration to map v1 bpm into TimingMap.",
);

const arrangementInvalidResult = migrateArrangementProject(fixtures.arrangement.missingDuration.project);

assertOk(!arrangementInvalidResult.ok, "Expected packed Arrangement missing-duration fixture to fail.");
assertOk(
  !arrangementInvalidResult.ok &&
    fixtures.arrangement.missingDuration.errorCodes.every((code) =>
      arrangementInvalidResult.errors.some((error) => error.code === code),
    ),
  "Expected packed Arrangement migration to require durationBeats.",
);
