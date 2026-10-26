import { normalizeProject, validateProject, type SequenceProject } from "@vixeq/core";

export const PROJECT_STORAGE_KEY = "vixeq.playground.project.v1";

const PROJECT_STORAGE_VERSION = 1;

type ProjectStorageEnvelope = {
  storageVersion: typeof PROJECT_STORAGE_VERSION;
  project: SequenceProject;
};

export type ProjectStorageLoadResult =
  | {
      status: "empty";
      project: null;
    }
  | {
      status: "loaded";
      project: SequenceProject;
    }
  | {
      status: "ignored";
      project: null;
    }
  | {
      status: "unavailable";
      project: null;
    };

export type ProjectStorageSaveResult = "saved" | "unavailable";

type ProjectStorage = Pick<Storage, "getItem" | "setItem">;

// Projects saved before 0.3 have no stepsPerBeat, which validateProject now
// requires. Fill in the 0.3 default (4) so the rest of the data is still
// validated strictly.
export const upgradeLegacyProject = (input: unknown): unknown =>
  input && typeof input === "object" && !Array.isArray(input) && !("stepsPerBeat" in input)
    ? { ...input, stepsPerBeat: 4 }
    : input;

const isEnvelope = (input: unknown): input is ProjectStorageEnvelope => {
  if (!input || typeof input !== "object") {
    return false;
  }

  const candidate = input as { storageVersion?: unknown; project?: unknown };
  return candidate.storageVersion === PROJECT_STORAGE_VERSION && candidate.project !== undefined;
};

export const loadStoredProject = (storage: ProjectStorage | undefined): ProjectStorageLoadResult => {
  if (!storage) {
    return { status: "unavailable", project: null };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(PROJECT_STORAGE_KEY);
  } catch {
    return { status: "unavailable", project: null };
  }

  if (!raw) {
    return { status: "empty", project: null };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isEnvelope(parsed)) {
      return { status: "ignored", project: null };
    }

    const project = upgradeLegacyProject(parsed.project);
    const result = validateProject(project);
    if (!result.ok) {
      return { status: "ignored", project: null };
    }

    return {
      status: "loaded",
      project: normalizeProject(project),
    };
  } catch {
    return { status: "ignored", project: null };
  }
};

export const saveStoredProject = (
  storage: ProjectStorage | undefined,
  project: SequenceProject,
): ProjectStorageSaveResult => {
  if (!storage) {
    return "unavailable";
  }

  try {
    const envelope: ProjectStorageEnvelope = {
      storageVersion: PROJECT_STORAGE_VERSION,
      project,
    };
    storage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(envelope));
    return "saved";
  } catch {
    return "unavailable";
  }
};
