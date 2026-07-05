import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@vixeq/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)) } },
});
