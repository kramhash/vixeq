import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@vixeq/core/dom",
        replacement: fileURLToPath(new URL("../../packages/core/src/dom.ts", import.meta.url)),
      },
      {
        find: "@vixeq/core",
        replacement: fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      },
    ],
  },
});
