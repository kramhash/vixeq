#!/usr/bin/env node
// Resolves what the Publish workflow releases, and fails before any gate runs
// when the release is not consistent:
//
// - the root and public package versions are in lockstep and valid semver;
// - a tag push names exactly `v<version>` (a manual dispatch is a dry run and
//   has no tag to match);
// - CHANGELOG.md has a `## <version>` section, which becomes the GitHub
//   Release notes.
//
// Prereleases publish under the `next` dist-tag, stable versions under
// `latest`.
//
// CLI: `node scripts/release-meta.mjs [--notes-out <file>]`. Reads
// GITHUB_EVENT_NAME, GITHUB_REF_TYPE, and GITHUB_REF_NAME, appends
// `version`, `tag`, `dist-tag`, `prerelease`, and `dry-run` to GITHUB_OUTPUT
// when set, and writes the release notes to `--notes-out` when given.

import { appendFileSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const publicPackages = [
  { name: "@vixeq/core", dir: "packages/core" },
  { name: "@vixeq/react", dir: "packages/react" },
  { name: "@vixeq/player-react", dir: "packages/player-react" },
];

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function readVersions(root = REPO_ROOT) {
  const read = (dir) => JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
  const versions = [{ name: "root package.json", version: read(".").version }];
  for (const pkg of publicPackages) {
    const manifest = read(pkg.dir);
    if (manifest.name !== pkg.name) {
      throw new Error(`${pkg.dir}/package.json is named ${manifest.name}, expected ${pkg.name}.`);
    }
    versions.push({ name: pkg.name, version: manifest.version });
  }
  return versions;
}

export function lockstepVersion(versions) {
  const [first] = versions;
  const mismatched = versions.filter((entry) => entry.version !== first.version);
  if (mismatched.length > 0) {
    const listing = versions.map((entry) => `${entry.name}@${entry.version}`).join(", ");
    throw new Error(`Package versions are not in lockstep: ${listing}.`);
  }
  if (typeof first.version !== "string" || !SEMVER.test(first.version)) {
    throw new Error(`Version ${first.version} is not a valid semver version.`);
  }
  return first.version;
}

export function isPrerelease(version) {
  return SEMVER.exec(version)?.[4] !== undefined;
}

export function distTagFor(version) {
  return isPrerelease(version) ? "next" : "latest";
}

/**
 * Returns the body of the `## <version>` section (the heading may carry a
 * ` - <date>` suffix), up to the next `## ` heading, trimmed.
 */
export function extractChangelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `## ${version}` || line.startsWith(`## ${version} `));
  if (start < 0) {
    throw new Error(`CHANGELOG.md has no "## ${version}" section.`);
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const body = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
  if (body === "") {
    throw new Error(`CHANGELOG.md section "## ${version}" is empty.`);
  }
  return body;
}

export function resolveRelease({ env, versions, changelog }) {
  const version = lockstepVersion(versions);
  const dryRun = env.GITHUB_EVENT_NAME !== "push";
  const tag = `v${version}`;
  if (!dryRun) {
    if (env.GITHUB_REF_TYPE !== "tag") {
      throw new Error(`A publishing run must be triggered by a tag push, not ${env.GITHUB_REF_TYPE} ${env.GITHUB_REF_NAME}.`);
    }
    if (env.GITHUB_REF_NAME !== tag) {
      throw new Error(`Tag ${env.GITHUB_REF_NAME} does not match the package version ${version} (expected ${tag}).`);
    }
  }
  return {
    version,
    tag,
    distTag: distTagFor(version),
    prerelease: isPrerelease(version),
    dryRun,
    notes: extractChangelogSection(changelog, version),
  };
}

function main(argv) {
  const notesIndex = argv.indexOf("--notes-out");
  const notesOut = notesIndex >= 0 ? argv[notesIndex + 1] : undefined;
  const release = resolveRelease({
    env: process.env,
    versions: readVersions(),
    changelog: readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8"),
  });

  const outputs = {
    version: release.version,
    tag: release.tag,
    "dist-tag": release.distTag,
    prerelease: String(release.prerelease),
    "dry-run": String(release.dryRun),
  };
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(""),
    );
  }
  if (notesOut) {
    writeFileSync(notesOut, `${release.notes}\n`);
  }
  for (const [key, value] of Object.entries(outputs)) {
    process.stdout.write(`${key}: ${value}\n`);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`::error::${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
