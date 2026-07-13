import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  assemblePages,
  inferPagesBase,
  pagesTargets,
  renderPagesIndex,
  targetBasePath,
} from "./build-pages.mjs";

test("infers GitHub Pages project base from the repository name", () => {
  assert.equal(inferPagesBase({ GITHUB_REPOSITORY: "kramhash/vixeq" }), "/vixeq");
  assert.equal(inferPagesBase({ VIXEQ_PAGES_BASE: "/preview/" }), "/preview");
  assert.equal(inferPagesBase({}), "");
});

test("renders the required multi-example index links", () => {
  const html = renderPagesIndex(pagesTargets, "/vixeq");

  assert.match(html, /href="\/vixeq\/playground\/"/);
  assert.match(html, /href="\/vixeq\/website-pulse\/"/);
  assert.match(html, /href="\/vixeq\/cycling-workout\/"/);
  assert.match(html, /Website Pulse/);
});

test("resolves target base paths with exactly one slash between parts", () => {
  assert.equal(targetBasePath({ id: "playground" }, "/vixeq/"), "/vixeq/playground/");
  assert.equal(targetBasePath({ id: "docs" }, ""), "/docs/");
});

test("assembles dist directories and writes the root index", async () => {
  const root = await mkdtemp(join(tmpdir(), "vixeq-pages-"));
  const outDir = join(root, "_site");
  const targets = pagesTargets.slice(0, 3);

  try {
    for (const target of targets) {
      const dist = join(root, target.dist);
      await mkdir(dist, { recursive: true });
      await writeFile(join(dist, "index.html"), `<p>${target.id}</p>`, "utf8");
    }

    await assemblePages({ rootDir: root, outDir, targets, pagesBase: "/vixeq" });

    const index = await readFile(join(outDir, "index.html"), "utf8");
    const playground = await readFile(join(outDir, "playground", "index.html"), "utf8");
    const pulse = await readFile(join(outDir, "website-pulse", "index.html"), "utf8");
    const cycling = await readFile(join(outDir, "cycling-workout", "index.html"), "utf8");

    assert.match(index, /\/vixeq\/playground\//);
    assert.equal(playground, "<p>playground</p>");
    assert.equal(pulse, "<p>website-pulse</p>");
    assert.equal(cycling, "<p>cycling-workout</p>");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
