#!/usr/bin/env node
// Cross-checks docs/behavior/*-matrix.md against the test suite: every row
// marked `covered` must have its ID actually present in a test file (as the
// matrix's own header convention requires: "Tests ... must include the ID in
// the test name or an adjacent comment, then change the row status to
// `covered`"). This catches drift -- a row marked covered whose backing test
// was later deleted, renamed, or never actually referenced the ID.
//
// `planned`/`blocked` rows are informational only and are not required to
// have a test yet.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const MATRIX_FILES = [
  "docs/behavior/playback-v2-matrix.md",
  "docs/behavior/timeline-arrangement-v2-matrix.md",
];

const TEST_ROOTS = ["packages/core/src", "packages/react/src", "packages/player-react/src"];

/** Recursively collect every *.test.ts / *.test.tsx file under a directory. */
function findTestFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      results.push(...findTestFiles(full));
    } else if (/\.test\.tsx?$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

/** Parse `| ID | Scenario | Expected result | Status |` rows from a matrix markdown file. */
function parseMatrixRows(markdown) {
  const rows = [];
  const lines = markdown.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length !== 4) continue;
    const [id, , , status] = cells;
    // Skip the header row and the `| --- | --- | --- | --- |` separator row.
    if (id === "ID" || /^-+$/.test(id)) continue;
    if (!["planned", "covered", "blocked"].includes(status)) continue;
    rows.push({ id, status });
  }
  return rows;
}

function main() {
  const testFiles = TEST_ROOTS.flatMap((root) => findTestFiles(join(repoRoot, root)));
  const testFileContents = testFiles.map((file) => ({ file, content: readFileSync(file, "utf8") }));

  const missing = [];
  let coveredCount = 0;
  let plannedCount = 0;
  let blockedCount = 0;

  for (const matrixPath of MATRIX_FILES) {
    const fullPath = join(repoRoot, matrixPath);
    const markdown = readFileSync(fullPath, "utf8");
    const rows = parseMatrixRows(markdown);

    for (const row of rows) {
      if (row.status === "planned") {
        plannedCount += 1;
        continue;
      }
      if (row.status === "blocked") {
        blockedCount += 1;
        continue;
      }
      coveredCount += 1;
      const backed = testFileContents.some(({ content }) => content.includes(row.id));
      if (!backed) {
        missing.push({ matrix: matrixPath, id: row.id });
      }
    }
  }

  console.log(
    `Behavior matrix: ${coveredCount} covered, ${plannedCount} planned, ${blockedCount} blocked.`,
  );

  if (missing.length > 0) {
    console.error("\nERROR: the following rows are marked `covered` but their ID was not found in any test file:");
    for (const { matrix, id } of missing) {
      console.error(`  - ${id} (${matrix})`);
    }
    console.error(
      "\nEither the backing test was deleted/renamed, or the row was marked `covered` without a test ID reference.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("All `covered` rows have a matching test ID reference.");
}

main();
