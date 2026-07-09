import { normalizeProject, validateProject } from "../validation";
import { createTimingMap, normalizeTimingMap, validateTimingMap } from "../timeline/timing";
import type { SequenceProject, ValidationIssue, ValidationResult } from "../types";
import type { ArrangementProject, ArrangementSection, CreateArrangementOptions } from "./types";

const DEFAULT_DURATION_BEATS = 4;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export const createArrangement = (options: CreateArrangementOptions = {}): ArrangementProject => ({
  version: 2,
  timing: normalizeTimingMap(options.timing),
  durationBeats: isFiniteNumber(options.durationBeats) && options.durationBeats > 0
    ? options.durationBeats
    : DEFAULT_DURATION_BEATS,
  patterns: options.patterns ?? {},
  sections: options.sections ?? [],
});

/**
 * Validates ArrangementProject v2 strictly. Migration from v1 is explicit;
 * legacy `bpm` is rejected instead of being converted to `timing`.
 */
export const validateArrangement = (input: unknown): ValidationResult => {
  const errors: ValidationIssue[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: [{ path: "$", message: "Arrangement must be an object." }] };
  }

  if (input.version !== 2) {
    errors.push({ path: "version", message: "Version must be 2." });
  }

  if (input.bpm !== undefined) {
    errors.push({ path: "bpm", message: "Arrangement must not include the removed bpm field." });
  }

  if (!isRecord(input.timing)) {
    errors.push({ path: "timing", message: "Timing must be an object." });
  } else {
    try {
      validateTimingMap(input.timing as ArrangementProject["timing"]);
    } catch (error) {
      errors.push({ path: "timing", message: error instanceof Error ? error.message : String(error) });
    }
  }

  let durationBeats: number | undefined;
  if (typeof input.durationBeats !== "number") {
    errors.push({ path: "durationBeats", message: "durationBeats must be a number." });
  } else if (!Number.isFinite(input.durationBeats) || input.durationBeats <= 0) {
    errors.push({ path: "durationBeats", message: "durationBeats must be a finite number greater than 0." });
  } else {
    durationBeats = input.durationBeats;
  }

  const patterns = isRecord(input.patterns) ? input.patterns : null;
  if (!patterns) {
    errors.push({ path: "patterns", message: "Patterns must be an object." });
  } else {
    for (const [patternId, pattern] of Object.entries(patterns)) {
      const result = validateProject(pattern);
      if (!result.ok) {
        for (const issue of result.errors) {
          errors.push({ path: `patterns.${patternId}.${issue.path}`, message: issue.message });
        }
      }
    }
  }

  if (!Array.isArray(input.sections)) {
    errors.push({ path: "sections", message: "Sections must be an array." });
    return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
  }

  const structurallyValid: ArrangementSection[] = [];
  const sectionIds = new Set<string>();

  input.sections.forEach((section, index) => {
    if (!isRecord(section)) {
      errors.push({ path: `sections.${index}`, message: "Section must be an object." });
      return;
    }

    let ok = true;

    if (typeof section.id !== "string" || !section.id.trim()) {
      errors.push({ path: `sections.${index}.id`, message: "Section id must be a non-empty string." });
      ok = false;
    } else if (sectionIds.has(section.id)) {
      errors.push({ path: `sections.${index}.id`, message: `Duplicate section id "${section.id}".` });
      ok = false;
    } else {
      sectionIds.add(section.id);
    }

    if (typeof section.patternId !== "string" || !(patterns && section.patternId in patterns)) {
      errors.push({
        path: `sections.${index}.patternId`,
        message: `Unknown pattern id "${String(section.patternId)}".`,
      });
      ok = false;
    }

    if (!isFiniteNumber(section.startBeat) || section.startBeat < 0) {
      errors.push({ path: `sections.${index}.startBeat`, message: "startBeat must be a non-negative number." });
      ok = false;
    }

    if (!isFiniteNumber(section.endBeat)) {
      errors.push({ path: `sections.${index}.endBeat`, message: "endBeat must be a number." });
      ok = false;
    } else if (isFiniteNumber(section.startBeat) && section.endBeat <= section.startBeat) {
      errors.push({ path: `sections.${index}.endBeat`, message: "endBeat must be greater than startBeat." });
      ok = false;
    } else if (durationBeats !== undefined && section.endBeat > durationBeats) {
      errors.push({
        path: `sections.${index}.endBeat`,
        message: `endBeat must be less than or equal to durationBeats (${durationBeats}).`,
      });
      ok = false;
    }

    if (ok) {
      structurallyValid.push(section as unknown as ArrangementSection);
    }
  });

  const ordered = [...structurallyValid].sort((a, b) => a.startBeat - b.startBeat);
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i].startBeat < ordered[i - 1].endBeat) {
      errors.push({
        path: "sections",
        message: `Section "${ordered[i].id}" overlaps with section "${ordered[i - 1].id}".`,
      });
    }
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
};

/**
 * Best-effort v2-only sanitization. This never maps legacy `bpm` to
 * `timing`; v1-to-v2 conversion belongs to `migrateArrangementProject()`.
 */
export const normalizeArrangement = (input: unknown): ArrangementProject => {
  if (!isRecord(input) || input.version !== 2) {
    return createArrangement();
  }

  const durationBeats = isFiniteNumber(input.durationBeats) && input.durationBeats > 0
    ? input.durationBeats
    : DEFAULT_DURATION_BEATS;

  const rawPatterns = isRecord(input.patterns) ? input.patterns : {};
  const patterns: Record<string, SequenceProject> = {};
  for (const [id, pattern] of Object.entries(rawPatterns)) {
    patterns[id] = normalizeProject(pattern);
  }

  const rawSections = Array.isArray(input.sections) ? input.sections : [];
  const sections: ArrangementSection[] = rawSections
    .filter(isRecord)
    .filter((section) => typeof section.patternId === "string" && section.patternId in patterns)
    .map((section, index): ArrangementSection => ({
      id: typeof section.id === "string" && section.id.trim() ? section.id : `section-${index + 1}`,
      patternId: section.patternId as string,
      startBeat: isFiniteNumber(section.startBeat) && section.startBeat >= 0 ? section.startBeat : 0,
      endBeat: isFiniteNumber(section.endBeat) ? section.endBeat : 0,
    }))
    .filter((section) => section.endBeat > section.startBeat && section.endBeat <= durationBeats);

  return {
    version: 2,
    timing: normalizeTimingMap(isRecord(input.timing) ? input.timing : createTimingMap()),
    durationBeats,
    patterns,
    sections,
  };
};
