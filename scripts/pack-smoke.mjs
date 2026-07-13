#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = path.join(rootDir, ".tmp", "pack-smoke");
const tarballDir = path.join(tempRoot, "tarballs");
const fixtureConsumerDir = path.join(rootDir, "fixtures", "pack-smoke", "consumer");
const migrationFixturePath = path.join(rootDir, "fixtures", "migration", "v1-to-v2.json");

// R2 compatibility fixtures (spec Section 10): set SMOKE_REACT_VERSION=18 or
// SMOKE_TS_VERSION=5.5 to override the consumer fixture's react/react-dom/
// @types or typescript version instead of deriving it from the live
// workspace, so the same consumer harness (ESM/CJS/SSR/types/vite-build) can
// verify the spec's supported minimum/alternate versions without touching
// the main workspace's own React 19 / TypeScript 5.9 setup. When either is
// set, the example-app build loop is skipped -- those apps are pinned to the
// workspace's own versions and aren't part of this peer-range claim.
const reactVersionOverride = process.env.SMOKE_REACT_VERSION ?? null;
const tsVersionOverride = process.env.SMOKE_TS_VERSION ?? null;
const isVersionFixture = Boolean(reactVersionOverride || tsVersionOverride);

const publicPackages = [
  { name: "@vixeq/core", dir: "packages/core" },
  { name: "@vixeq/react", dir: "packages/react" },
  {
    name: "@vixeq/player-react",
    dir: "packages/player-react",
    // `./styles.css` is a plain CSS asset export, not a JS/TS module -- attw
    // has no types to resolve for it and always reports "Resolution
    // failed" for non-code entrypoints, so it's excluded from analysis.
    attwExcludeEntrypoints: ["./styles.css"],
  },
];

const smokeProjects = [
  { source: "apps/playground", temp: "examples/playground" },
  { source: "examples/react-player", temp: "examples/react-player" },
  { source: "examples/vanilla-core", temp: "examples/vanilla-core" },
  { source: "examples/arrangement-demo", temp: "examples/arrangement-demo" },
  { source: "examples/cycling-workout", temp: "examples/cycling-workout" },
  { source: "examples/website-pulse", temp: "examples/website-pulse" },
  { source: "examples/website-svg", temp: "examples/website-svg" },
];

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const cwd = options.cwd ?? rootDir;
  console.log(`\n$ ${command} ${args.join(" ")}\n  cwd: ${path.relative(rootDir, cwd) || "."}`);
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });

  child.on("error", reject);
  child.on("exit", (code, signal) => {
    if (code === 0) {
      resolve();
      return;
    }
    reject(new Error(`${command} ${args.join(" ")} failed with ${signal ?? `exit code ${code}`}`));
  });
});

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));

const writeJson = async (filePath, value) => {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const toPortablePath = (value) => value.split(path.sep).join("/");

const fileSpecFor = (projectDir, tarballPath) =>
  `file:${toPortablePath(path.relative(projectDir, tarballPath))}`;

const packageSections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

const findDependencyVersion = (packageJsons, name) => {
  for (const packageJson of packageJsons) {
    for (const section of packageSections) {
      const version = packageJson[section]?.[name];
      if (version) return version;
    }
  }
  throw new Error(`Unable to find dependency version for ${name}.`);
};

const copyProject = async (sourceDir, targetDir) => {
  await cp(sourceDir, targetDir, {
    recursive: true,
    filter: (source) => {
      const basename = path.basename(source);
      return basename !== "node_modules" && basename !== "dist" && basename !== ".vite";
    },
  });
};

const rewriteVixeqDependencies = (packageJson, projectDir, tarballs) => {
  for (const section of packageSections) {
    const dependencies = packageJson[section];
    if (!dependencies) continue;

    for (const [name, tarballPath] of tarballs) {
      if (dependencies[name]) {
        dependencies[name] = fileSpecFor(projectDir, tarballPath);
      }
    }
  }
};

const stripWorkspaceAliases = async (projectDir, usesReactPlugin) => {
  const tsconfigPath = path.join(projectDir, "tsconfig.json");
  const tsconfig = await readJson(tsconfigPath);
  if (tsconfig.compilerOptions) {
    delete tsconfig.compilerOptions.baseUrl;
    delete tsconfig.compilerOptions.paths;
  }
  await writeJson(tsconfigPath, tsconfig);

  const viteConfigPath = path.join(projectDir, "vite.config.ts");
  const viteConfig = usesReactPlugin
    ? [
        'import { defineConfig } from "vite";',
        'import react from "@vitejs/plugin-react";',
        "",
        "export default defineConfig({",
        "  plugins: [react()],",
        "});",
        "",
      ].join("\n")
    : [
        'import { defineConfig } from "vite";',
        "",
        "export default defineConfig({});",
        "",
      ].join("\n");
  await writeFile(viteConfigPath, viteConfig);
};

const packPublicPackages = async () => {
  const tarballs = new Map();

  for (const publicPackage of publicPackages) {
    await run("pnpm", ["--filter", publicPackage.name, "build"]);

    const before = new Set(await readdir(tarballDir));
    await run("pnpm", ["pack", "--pack-destination", tarballDir], {
      cwd: path.join(rootDir, publicPackage.dir),
    });

    const after = await readdir(tarballDir);
    const created = after.filter((name) => name.endsWith(".tgz") && !before.has(name));
    if (created.length !== 1) {
      throw new Error(`Expected exactly one tarball for ${publicPackage.name}, found ${created.length}.`);
    }

    tarballs.set(publicPackage.name, path.join(tarballDir, created[0]));
  }

  return tarballs;
};

// spec Section 10 "API and package gates": publint and Are The Types Wrong
// on packed packages. attw uses the "node16" profile (ignores "node10"
// legacy resolution) because the supported matrix (spec Section 10) targets
// modern Node.js/TypeScript moduleResolution, not the pre-`exports`-field
// classic resolution algorithm; a subpath export like `@vixeq/core/dom` is
// expected to fail node10 resolution and that failure is out of scope here.
const verifyPackedPackages = async (tarballs) => {
  for (const publicPackage of publicPackages) {
    const tarballPath = tarballs.get(publicPackage.name);
    console.log(`\nVerifying packed package: ${publicPackage.name}`);
    await run("pnpm", ["exec", "publint", tarballPath]);

    // `tarballPath` (the positional arg) must precede `--exclude-entrypoints`,
    // since that option is variadic and would otherwise swallow it too.
    const attwArgs = ["exec", "attw", "--profile", "node16", tarballPath];
    if (publicPackage.attwExcludeEntrypoints?.length) {
      attwArgs.push("--exclude-entrypoints", ...publicPackage.attwExcludeEntrypoints);
    }
    await run("pnpm", attwArgs);
  }
};

const prepareTempWorkspace = async (tarballs) => {
  const overrides = Object.fromEntries(
    [...tarballs].map(([name, tarballPath]) => [name, fileSpecFor(tempRoot, tarballPath)]),
  );

  await writeJson(path.join(tempRoot, "package.json"), {
    name: "vixeq-pack-smoke",
    version: "0.0.0",
    private: true,
    packageManager: "pnpm@10.12.1",
    pnpm: {
      overrides,
    },
  });
  await writeFile(path.join(tempRoot, "pnpm-workspace.yaml"), 'packages:\n  - "consumer"\n  - "examples/*"\n');
  await cp(path.join(rootDir, "tsconfig.base.json"), path.join(tempRoot, "tsconfig.base.json"));

  const sourcePackageJsons = [
    await readJson(path.join(rootDir, "package.json")),
    await readJson(path.join(rootDir, "apps", "playground", "package.json")),
    await readJson(path.join(rootDir, "examples", "react-player", "package.json")),
    await readJson(path.join(rootDir, "packages", "react", "package.json")),
  ];

  const consumerDir = path.join(tempRoot, "consumer");
  await cp(fixtureConsumerDir, consumerDir, { recursive: true });
  await writeJson(path.join(consumerDir, "package.json"), {
    name: "vixeq-pack-smoke-consumer",
    version: "0.0.0",
    private: true,
    type: "module",
    scripts: {
      "smoke:core-esm": "node src/core-esm.mjs",
      "smoke:core-cjs": "node src/core-cjs.cjs",
      "smoke:core-migration": "node src/core-migration.mjs",
      "smoke:react-ssr": "node src/react-ssr.mjs",
      "smoke:types": "tsc --noEmit",
      "smoke:vite": "vite build",
      smoke: "pnpm run smoke:core-esm && pnpm run smoke:core-cjs && pnpm run smoke:core-migration && pnpm run smoke:react-ssr && pnpm run smoke:types && pnpm run smoke:vite",
    },
    dependencies: {
      "@vixeq/core": fileSpecFor(consumerDir, tarballs.get("@vixeq/core")),
      "@vixeq/react": fileSpecFor(consumerDir, tarballs.get("@vixeq/react")),
      "@vixeq/player-react": fileSpecFor(consumerDir, tarballs.get("@vixeq/player-react")),
      react: reactVersionOverride ? `${reactVersionOverride}.x` : findDependencyVersion(sourcePackageJsons, "react"),
      "react-dom": reactVersionOverride
        ? `${reactVersionOverride}.x`
        : findDependencyVersion(sourcePackageJsons, "react-dom"),
    },
    devDependencies: {
      "@types/react": reactVersionOverride
        ? `${reactVersionOverride}.x`
        : findDependencyVersion(sourcePackageJsons, "@types/react"),
      "@types/react-dom": reactVersionOverride
        ? `${reactVersionOverride}.x`
        : findDependencyVersion(sourcePackageJsons, "@types/react-dom"),
      "@vitejs/plugin-react": findDependencyVersion(sourcePackageJsons, "@vitejs/plugin-react"),
      typescript: tsVersionOverride ? `${tsVersionOverride}.x` : findDependencyVersion(sourcePackageJsons, "typescript"),
      vite: findDependencyVersion(sourcePackageJsons, "vite"),
    },
  });
  await cp(migrationFixturePath, path.join(consumerDir, "src", "migration-v1-to-v2.json"));

  if (isVersionFixture) {
    console.log(
      `\nVersion fixture active (react=${reactVersionOverride ?? "workspace"}, typescript=${tsVersionOverride ?? "workspace"}); skipping example-app builds.`,
    );
    return;
  }

  for (const project of smokeProjects) {
    const sourceDir = path.join(rootDir, project.source);
    const projectDir = path.join(tempRoot, project.temp);
    await copyProject(sourceDir, projectDir);

    const packageJsonPath = path.join(projectDir, "package.json");
    const packageJson = await readJson(packageJsonPath);
    rewriteVixeqDependencies(packageJson, projectDir, tarballs);
    await writeJson(packageJsonPath, packageJson);

    const usesReactPlugin = Boolean(
      packageJson.dependencies?.["@vitejs/plugin-react"] ||
        packageJson.devDependencies?.["@vitejs/plugin-react"],
    );
    await stripWorkspaceAliases(projectDir, usesReactPlugin);
  }
};

const assertFileExists = async (filePath) => {
  const result = await stat(filePath);
  if (!result.isFile()) {
    throw new Error(`Expected file at ${filePath}.`);
  }
};

await rm(tempRoot, { recursive: true, force: true });
await mkdir(tarballDir, { recursive: true });

const tarballs = await packPublicPackages();

for (const tarballPath of tarballs.values()) {
  await assertFileExists(tarballPath);
}

await verifyPackedPackages(tarballs);
await prepareTempWorkspace(tarballs);

await run("pnpm", ["install", "--no-lockfile"], { cwd: tempRoot });
await run("pnpm", ["--filter", "vixeq-pack-smoke-consumer", "run", "smoke"], { cwd: tempRoot });

if (!isVersionFixture) {
  for (const project of smokeProjects) {
    const packageJson = await readJson(path.join(tempRoot, project.temp, "package.json"));
    await run("pnpm", ["--filter", packageJson.name, "run", "build"], { cwd: tempRoot });
  }
}

console.log("\nPack smoke completed successfully.");
