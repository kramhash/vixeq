import { SEQUENCER_LIMITS } from "../limits";
import { clamp } from "../project";
import { normalizeProject, validateProject } from "../validation";
import type { SequenceProject, ValidationIssue, ValidationResult } from "../types";
import type { ArrangementProject, ArrangementSection, CreateArrangementOptions } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const createArrangement = (options: CreateArrangementOptions = {}): ArrangementProject => ({
  version: 1,
  bpm: clamp(options.bpm ?? SEQUENCER_LIMITS.defaultBpm, SEQUENCER_LIMITS.minBpm, SEQUENCER_LIMITS.maxBpm),
  patterns: options.patterns ?? {},
  sections: options.sections ?? [],
});

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Validates an ArrangementProject-shaped input. Checks: version/bpm range,
 * each pattern is a valid SequenceProject (delegates to validateProject),
 * every section references an existing pattern with 0 <= startBeat < endBeat,
 * and sections do not overlap.
 */
export const validateArrangement = (input: unknown): ValidationResult => {
  const errors: ValidationIssue[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: [{ path: "$", message: "Arrangement must be an object." }] };
  }

  if (input.version !== 1) {
    errors.push({ path: "version", message: "Version must be 1." });
  }

  if (typeof input.bpm !== "number" || Number.isNaN(input.bpm)) {
    errors.push({ path: "bpm", message: "BPM must be a number." });
  } else if (input.bpm < SEQUENCER_LIMITS.minBpm || input.bpm > SEQUENCER_LIMITS.maxBpm) {
    errors.push({
      path: "bpm",
      message: `BPM must be between ${SEQUENCER_LIMITS.minBpm} and ${SEQUENCER_LIMITS.maxBpm}.`,
    });
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
 * Best-effort sanitization (types/ranges), mirroring normalizeProject:
 * clamps bpm, normalizes every pattern via normalizeProject, and drops
 * sections with an unknown patternId or an invalid beat range. Does NOT
 * enforce non-overlap — use validateArrangement for that.
 */
export const normalizeArrangement = (input: unknown): ArrangementProject => {
  if (!isRecord(input)) {
    return createArrangement();
  }

  const bpm = clamp(
    typeof input.bpm === "number" ? input.bpm : SEQUENCER_LIMITS.defaultBpm,
    SEQUENCER_LIMITS.minBpm,
    SEQUENCER_LIMITS.maxBpm,
  );

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
    .filter((section) => section.endBeat > section.startBeat);

  return {
    version: 1,
    bpm,
    patterns,
    sections,
  };
};
