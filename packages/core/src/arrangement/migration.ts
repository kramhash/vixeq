import { SEQUENCER_LIMITS } from "../limits";
import { createTimingMap } from "../timeline/timing";
import { validateProject } from "../validation";
import type { MigrationIssue, SequenceProject } from "../types";
import { validateArrangement } from "./project";
import type {
  ArrangementMigrationOptions,
  ArrangementMigrationResult,
  ArrangementProject,
  ArrangementProjectV1,
  ArrangementSection,
} from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFinitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const isValidBpm = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= SEQUENCER_LIMITS.minBpm &&
  value <= SEQUENCER_LIMITS.maxBpm;

const validateV1Arrangement = (input: unknown): { ok: true; project: ArrangementProjectV1 } | { ok: false; errors: MigrationIssue[] } => {
  const errors: MigrationIssue[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [{ code: "ARRANGEMENT_INVALID", message: "Arrangement must be an object.", path: "$" }],
    };
  }

  if (input.version !== 1) {
    errors.push({ code: "ARRANGEMENT_VERSION", message: "Arrangement version must be 1.", path: "version" });
  }

  if (!isValidBpm(input.bpm)) {
    errors.push({
      code: "ARRANGEMENT_BPM",
      message: `Arrangement bpm must be a finite number between ${SEQUENCER_LIMITS.minBpm} and ${SEQUENCER_LIMITS.maxBpm}.`,
      path: "bpm",
    });
  }

  const patterns = isRecord(input.patterns) ? input.patterns : null;
  if (!patterns) {
    errors.push({ code: "ARRANGEMENT_PATTERNS", message: "Patterns must be an object.", path: "patterns" });
  } else {
    for (const [patternId, pattern] of Object.entries(patterns)) {
      const result = validateProject(pattern);
      if (!result.ok) {
        for (const issue of result.errors) {
          errors.push({
            code: "ARRANGEMENT_PATTERN",
            message: issue.message,
            path: `patterns.${patternId}.${issue.path}`,
          });
        }
      }
    }
  }

  if (!Array.isArray(input.sections)) {
    errors.push({ code: "ARRANGEMENT_SECTIONS", message: "Sections must be an array.", path: "sections" });
  } else {
    const structurallyValid: ArrangementSection[] = [];
    const sectionIds = new Set<string>();

    input.sections.forEach((section, index) => {
      if (!isRecord(section)) {
        errors.push({ code: "ARRANGEMENT_SECTION", message: "Section must be an object.", path: `sections.${index}` });
        return;
      }

      let ok = true;
      if (typeof section.id !== "string" || !section.id.trim()) {
        errors.push({
          code: "ARRANGEMENT_SECTION_ID",
          message: "Section id must be a non-empty string.",
          path: `sections.${index}.id`,
        });
        ok = false;
      } else if (sectionIds.has(section.id)) {
        errors.push({
          code: "ARRANGEMENT_SECTION_ID",
          message: `Duplicate section id "${section.id}".`,
          path: `sections.${index}.id`,
        });
        ok = false;
      } else {
        sectionIds.add(section.id);
      }

      if (typeof section.patternId !== "string" || !(patterns && section.patternId in patterns)) {
        errors.push({
          code: "ARRANGEMENT_SECTION_PATTERN",
          message: `Unknown pattern id "${String(section.patternId)}".`,
          path: `sections.${index}.patternId`,
        });
        ok = false;
      }

      if (typeof section.startBeat !== "number" || !Number.isFinite(section.startBeat) || section.startBeat < 0) {
        errors.push({
          code: "ARRANGEMENT_SECTION_RANGE",
          message: "startBeat must be a finite, non-negative number.",
          path: `sections.${index}.startBeat`,
        });
        ok = false;
      }

      if (typeof section.endBeat !== "number" || !Number.isFinite(section.endBeat)) {
        errors.push({
          code: "ARRANGEMENT_SECTION_RANGE",
          message: "endBeat must be a finite number.",
          path: `sections.${index}.endBeat`,
        });
        ok = false;
      } else if (
        typeof section.startBeat === "number" &&
        Number.isFinite(section.startBeat) &&
        section.endBeat <= section.startBeat
      ) {
        errors.push({
          code: "ARRANGEMENT_SECTION_RANGE",
          message: "endBeat must be greater than startBeat.",
          path: `sections.${index}.endBeat`,
        });
        ok = false;
      }

      if (ok) {
        structurallyValid.push(section as unknown as ArrangementSection);
      }
    });

    const ordered = [...structurallyValid].sort((a, b) => a.startBeat - b.startBeat);
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index].startBeat < ordered[index - 1].endBeat) {
        errors.push({
          code: "ARRANGEMENT_SECTION_OVERLAP",
          message: `Section "${ordered[index].id}" overlaps with section "${ordered[index - 1].id}".`,
          path: "sections",
        });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, project: input as ArrangementProjectV1 };
};

export const migrateArrangementProject = (
  input: unknown,
  options: ArrangementMigrationOptions = {},
): ArrangementMigrationResult => {
  const v1Result = validateV1Arrangement(input);
  if (!v1Result.ok) {
    return v1Result;
  }

  if (!isFinitePositive(options.durationBeats)) {
    return {
      ok: false,
      errors: [
        {
          code: "ARRANGEMENT_DURATION_REQUIRED",
          message: "durationBeats option is required and must be a finite number greater than 0.",
          path: "durationBeats",
        },
      ],
    };
  }

  const source = v1Result.project;
  const largestSectionEnd = source.sections.reduce((max, section) => Math.max(max, section.endBeat), 0);
  if (options.durationBeats < largestSectionEnd) {
    return {
      ok: false,
      errors: [
        {
          code: "ARRANGEMENT_DURATION_TOO_SHORT",
          message: `durationBeats must be at least the largest section endBeat (${largestSectionEnd}).`,
          path: "durationBeats",
        },
      ],
    };
  }

  const project: ArrangementProject = {
    version: 2,
    timing: createTimingMap({ bpm: source.bpm }),
    durationBeats: options.durationBeats,
    patterns: source.patterns as Record<string, SequenceProject>,
    sections: source.sections,
  };

  const result = validateArrangement(project);
  if (!result.ok) {
    return {
      ok: false,
      errors: result.errors.map((issue) => ({
        code: "ARRANGEMENT_V2_INVALID",
        message: issue.message,
        path: issue.path,
      })),
    };
  }

  return { ok: true, project, warnings: [] };
};
