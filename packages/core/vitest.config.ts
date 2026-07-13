import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        // Export-only barrels: no logic/branches of their own.
        "src/index.ts",
        "src/arrangement/index.ts",
        "src/timeline/index.ts",
        // Type-only modules: no runtime exports, nothing to branch-cover.
        "src/types.ts",
        "src/arrangement/types.ts",
        "src/timeline/types.ts",
      ],
      thresholds: {
        branches: 90,
        // 0.9.0 release gate (spec Section 10): PlaybackTransport, all three
        // Engines, timing conversion, and migration require 100% branch
        // coverage.
        "src/playbackTransport.ts": { branches: 100 },
        "src/SequencerEngine.ts": { branches: 100 },
        "src/arrangement/ArrangementEngine.ts": { branches: 100 },
        "src/timeline/TimelineEngine.ts": { branches: 100 },
        "src/timeline/timing.ts": { branches: 100 },
        "src/arrangement/migration.ts": { branches: 100 },
        "src/timeline/migration.ts": { branches: 100 },
      },
    },
  },
});
