import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  distTagFor,
  extractChangelogSection,
  isPrerelease,
  lockstepVersion,
  readVersions,
  resolveRelease,
} from "./release-meta.mjs";

const versionsAt = (version, overrides = {}) =>
  ["root package.json", "@vixeq/core", "@vixeq/react", "@vixeq/player-react"].map((name) => ({
    name,
    version: overrides[name] ?? version,
  }));

const changelog = [
  "# Changelog",
  "",
  "## Unreleased",
  "",
  "- pending",
  "",
  "## 1.0.0-rc.1 - 2026-10-20",
  "",
  "### Fixed",
  "",
  "- rc fix",
  "",
  "## 1.0.0-rc.10",
  "",
  "- a later rc",
  "",
  "## 0.9.0 - 2026-07-13",
  "",
  "- stable",
  "",
].join("\n");

const tagPush = (refName) => ({ GITHUB_EVENT_NAME: "push", GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: refName });

test("reads the repository's lockstep versions", () => {
  const versions = readVersions();
  assert.equal(versions.length, 4);
  assert.equal(lockstepVersion(versions), versions[0].version);
});

test("rejects versions that are not in lockstep or not semver", () => {
  assert.throws(
    () => lockstepVersion(versionsAt("1.0.0-rc.1", { "@vixeq/react": "1.0.0" })),
    /not in lockstep: .*@vixeq\/react@1\.0\.0/,
  );
  assert.throws(() => lockstepVersion(versionsAt("1.0")), /not a valid semver/);
  assert.throws(() => lockstepVersion(versionsAt("01.0.0")), /not a valid semver/);
  assert.throws(() => lockstepVersion(versionsAt("1.0.0+build.1")), /not a valid semver/);
});

test("publishes prereleases under next and stable versions under latest", () => {
  assert.equal(distTagFor("1.0.0-rc.1"), "next");
  assert.equal(distTagFor("1.0.0"), "latest");
  assert.equal(isPrerelease("1.0.0-rc.1"), true);
  assert.equal(isPrerelease("1.0.0"), false);
});

test("extracts exactly the matching CHANGELOG section", () => {
  assert.equal(extractChangelogSection(changelog, "1.0.0-rc.1"), "### Fixed\n\n- rc fix");
  assert.equal(extractChangelogSection(changelog, "1.0.0-rc.10"), "- a later rc");
  assert.equal(extractChangelogSection(changelog, "0.9.0"), "- stable");
  assert.throws(() => extractChangelogSection(changelog, "1.0.0"), /no "## 1\.0\.0" section/);
  assert.throws(() => extractChangelogSection("## 1.0.0\n\n## 0.9.0\n- x", "1.0.0"), /is empty/);
  assert.equal(extractChangelogSection(changelog.replaceAll("\n", "\r\n"), "1.0.0-rc.1"), "### Fixed\n\n- rc fix");
  assert.equal(extractChangelogSection("## 1.0.0 \n- x\n", "1.0.0"), "- x");
});

test("resolves a tag push that matches the version", () => {
  const release = resolveRelease({ env: tagPush("v1.0.0-rc.1"), versions: versionsAt("1.0.0-rc.1"), changelog });
  assert.deepEqual(release, {
    version: "1.0.0-rc.1",
    tag: "v1.0.0-rc.1",
    distTag: "next",
    prerelease: true,
    dryRun: false,
    notes: "### Fixed\n\n- rc fix",
  });
});

test("rejects a tag that does not match the version", () => {
  assert.throws(
    () => resolveRelease({ env: tagPush("v1.0.0"), versions: versionsAt("1.0.0-rc.1"), changelog }),
    /Tag v1\.0\.0 does not match the package version 1\.0\.0-rc\.1/,
  );
});

test("rejects a publishing run that is not a tag push", () => {
  assert.throws(
    () =>
      resolveRelease({
        env: { GITHUB_EVENT_NAME: "push", GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "main" },
        versions: versionsAt("1.0.0-rc.1"),
        changelog,
      }),
    /must be triggered by a tag push, not branch main/,
  );
});

test("treats a manual dispatch as a dry run without a tag check but with every other check", () => {
  const env = { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "main" };
  const release = resolveRelease({ env, versions: versionsAt("0.9.0"), changelog });
  assert.equal(release.dryRun, true);
  assert.equal(resolveRelease({ env: {}, versions: versionsAt("0.9.0"), changelog }).dryRun, true);
  assert.equal(release.distTag, "latest");
  assert.throws(() => resolveRelease({ env, versions: versionsAt("1.0.0"), changelog }), /no "## 1\.0\.0" section/);
  assert.throws(
    () => resolveRelease({ env, versions: versionsAt("1.0.0-rc.1", { "@vixeq/core": "0.9.0" }), changelog }),
    /not in lockstep/,
  );
});

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "release-meta.mjs");

const runCli = (scriptPath, env, args = []) => {
  const childEnv = { ...process.env, ...env };
  for (const key of ["GITHUB_EVENT_NAME", "GITHUB_REF_TYPE", "GITHUB_REF_NAME", "GITHUB_OUTPUT"]) {
    if (!(key in env)) delete childEnv[key];
  }
  return spawnSync(process.execPath, [scriptPath, ...args], { env: childEnv, encoding: "utf8" });
};

test("the CLI writes GITHUB_OUTPUT lines and the notes file, also when started through a symlinked path", () => {
  const dir = mkdtempSync(join(tmpdir(), "vixeq-release-meta-"));
  try {
    const link = join(dir, "link with space.mjs");
    symlinkSync(SCRIPT, link);
    for (const scriptPath of [SCRIPT, link]) {
      const output = join(dir, "output.txt");
      const notes = join(dir, "notes.md");
      const result = runCli(scriptPath, { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_OUTPUT: output }, ["--notes-out", notes]);
      assert.equal(result.status, 0, result.stderr);
      const lines = readFileSync(output, "utf8").trimEnd().split("\n");
      const version = readVersions()[0].version;
      assert.deepEqual(lines.slice(-5), [
        `version=${version}`,
        `tag=v${version}`,
        `dist-tag=${distTagFor(version)}`,
        `prerelease=${isPrerelease(version)}`,
        "dry-run=true",
      ]);
      assert.match(readFileSync(notes, "utf8"), /\S\n$/);
      rmSync(output);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI fails with an Actions error annotation on a mismatched tag", () => {
  const result = runCli(SCRIPT, { GITHUB_EVENT_NAME: "push", GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.0.0-mismatch" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^::error::Tag v0\.0\.0-mismatch does not match the package version/);
});
