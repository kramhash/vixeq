import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  base: process.env.VIXEQ_BASE_PATH ?? "./",
  resolve: {
    alias: [
      {
        find: "@vixeq/core",
        replacement: fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      },
    ],
  },
});
