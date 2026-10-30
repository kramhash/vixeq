// Validates audio-to-sequence output against the workspace @vixeq/core build.
// Usage: node contract/validate.mjs <file.json>...  (build core first: pnpm --filter @vixeq/core build)
import { readFile } from "node:fs/promises";

const core = await import(new URL("../../../packages/core/dist/index.js", import.meta.url));

let failed = false;
for (const path of process.argv.slice(2)) {
  const project = JSON.parse(await readFile(path, "utf8"));
  const result = project.version === 2 ? core.validateArrangement(project) : core.validateProject(project);
  if (result.ok) {
    console.log(`ok ${path}`);
  } else {
    failed = true;
    console.error(`invalid ${path}`);
    for (const issue of result.errors) {
      console.error(`  ${issue.path}: ${issue.message}`);
    }
  }
}

process.exitCode = failed ? 1 : 0;
