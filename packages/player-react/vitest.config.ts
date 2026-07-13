import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: {
    "@vixeq/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    "@vixeq/react": fileURLToPath(new URL("../react/src/index.ts", import.meta.url)),
  } },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/**/*.d.ts",
        // Export-only barrel: no logic/branches of its own.
        "src/index.tsx",
      ],
      thresholds: {
        branches: 85,
      },
    },
  },
});
