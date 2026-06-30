import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
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
      {
        find: "@vixeq/react",
        replacement: fileURLToPath(new URL("../../packages/react/src/index.ts", import.meta.url)),
      },
      {
        find: "@vixeq/player-react/styles.css",
        replacement: fileURLToPath(new URL("../../packages/player-react/src/styles.css", import.meta.url)),
      },
      {
        find: "@vixeq/player-react",
        replacement: fileURLToPath(new URL("../../packages/player-react/src/index.tsx", import.meta.url)),
      },
    ],
  },
});
