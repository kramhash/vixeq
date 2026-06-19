import { describe, expect, it } from "vitest";
import { createProject, setProjectBpm } from "@viseq/core";
import { loadStoredProject, PROJECT_STORAGE_KEY, saveStoredProject } from "./projectStorage";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("project storage", () => {
  it("loads an empty state when no project has been saved", () => {
    const storage = new MemoryStorage();

    expect(loadStoredProject(storage).status).toBe("empty");
  });

  it("saves and loads a normalized project envelope", () => {
    const storage = new MemoryStorage();
    const project = setProjectBpm(createProject(), 142);

    expect(saveStoredProject(storage, project)).toBe("saved");

    const loaded = loadStoredProject(storage);
    expect(loaded.status).toBe("loaded");
    expect(loaded.project?.bpm).toBe(142);
  });

  it("ignores invalid stored JSON", () => {
    const storage = new MemoryStorage();
    storage.setItem(PROJECT_STORAGE_KEY, "{");

    expect(loadStoredProject(storage).status).toBe("ignored");
  });

  it("ignores envelopes with invalid projects", () => {
    const storage = new MemoryStorage();
    storage.setItem(PROJECT_STORAGE_KEY, JSON.stringify({ storageVersion: 1, project: { version: 1 } }));

    expect(loadStoredProject(storage).status).toBe("ignored");
  });

  it("reports unavailable storage when storage access fails", () => {
    const storage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };

    expect(loadStoredProject(storage).status).toBe("unavailable");
    expect(saveStoredProject(storage, createProject())).toBe("unavailable");
  });
});
