#!/usr/bin/env node
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

export const pagesTargets = [
  {
    id: "playground",
    packageName: "vixeq-playground",
    buildScript: "build",
    dist: "apps/playground/dist",
    title: "Playground",
    eyebrow: "Sequencer editor",
    description: "Build, import, export, and persist sequence projects while driving the React player.",
  },
  {
    id: "website-pulse",
    packageName: "vixeq-example-website-pulse",
    buildScript: "build",
    dist: "examples/website-pulse/dist",
    title: "Website Pulse",
    eyebrow: "Flagship integration",
    description: "One audio transport shared by channel animation and Timeline cues.",
  },
  {
    id: "cycling-workout",
    packageName: "vixeq-example-cycling-workout",
    buildScript: "build",
    dist: "examples/cycling-workout/dist",
    title: "Cycling Workout",
    eyebrow: "Arrangement editor",
    description: "A non-musical Arrangement workflow for interval editing and playback.",
  },
  {
    id: "arrangement-demo",
    packageName: "vixeq-example-arrangement-demo",
    buildScript: "build",
    dist: "examples/arrangement-demo/dist",
    title: "Arrangement Demo",
    eyebrow: "Tempo map",
    description: "Section-boundary playback with Arrangement v2 and media transport controls.",
  },
  {
    id: "docs",
    packageName: "vixeq-docs",
    buildScript: "build:site",
    dist: "apps/docs/dist",
    title: "Docs",
    eyebrow: "Guides and API",
    description: "Reference documentation for the Core, React, and Player React packages.",
  },
];

export function normalizeBasePath(value) {
  if (!value || value === "/") return "";
  const trimmed = value.replace(/^\/+|\/+$/g, "");
  return `/${trimmed}`;
}

export function inferPagesBase(env = process.env) {
  if (env.VIXEQ_PAGES_BASE !== undefined) {
    return normalizeBasePath(env.VIXEQ_PAGES_BASE);
  }
  const repository = env.GITHUB_REPOSITORY;
  if (repository?.includes("/")) {
    return normalizeBasePath(repository.split("/").at(-1));
  }
  return env.GITHUB_ACTIONS === "true" ? "/vixeq" : "";
}

export function targetBasePath(target, pagesBase = "") {
  return `${normalizeBasePath(pagesBase)}/${target.id}/`;
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  })[character]);

export function renderPagesIndex(targets = pagesTargets, pagesBase = "") {
  const cards = targets
    .map((target) => {
      const href = targetBasePath(target, pagesBase);
      return `
        <article class="example-card">
          <p>${escapeHtml(target.eyebrow)}</p>
          <h2>${escapeHtml(target.title)}</h2>
          <span>${escapeHtml(target.description)}</span>
          <a href="${href}">Open ${escapeHtml(target.title)}</a>
        </article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vixeq examples</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #101114;
        --panel: #181c21;
        --panel-strong: #202731;
        --text: #f6f0e6;
        --muted: #aab1ba;
        --line: #34404d;
        --accent: #62d6a3;
        --accent-2: #ffb15c;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          linear-gradient(120deg, rgba(98, 214, 163, 0.16), transparent 34%),
          linear-gradient(210deg, rgba(255, 177, 92, 0.14), transparent 36%),
          var(--bg);
        color: var(--text);
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      main {
        width: min(1120px, calc(100% - 32px));
        margin: 0 auto;
        padding: clamp(32px, 7vw, 80px) 0;
      }

      .hero {
        display: grid;
        gap: 16px;
        padding-bottom: 32px;
        border-bottom: 1px solid var(--line);
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        width: fit-content;
        color: var(--muted);
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .brand-mark {
        width: 34px;
        height: 34px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background:
          linear-gradient(135deg, transparent 28%, var(--accent) 29% 36%, transparent 37%),
          linear-gradient(45deg, transparent 38%, var(--accent-2) 39% 47%, transparent 48%),
          var(--panel);
      }

      h1 {
        max-width: 760px;
        margin: 0;
        font-size: clamp(2.25rem, 6vw, 5rem);
        line-height: 0.95;
        letter-spacing: 0;
      }

      .hero p:last-child {
        max-width: 700px;
        margin: 0;
        color: var(--muted);
        font-size: clamp(1rem, 2vw, 1.2rem);
        line-height: 1.65;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
        gap: 16px;
        margin-top: 28px;
      }

      .example-card {
        min-height: 250px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 22px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: linear-gradient(180deg, var(--panel-strong), var(--panel));
      }

      .example-card p {
        margin: 0;
        color: var(--accent);
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .example-card h2 {
        margin: 0;
        font-size: 1.45rem;
        letter-spacing: 0;
      }

      .example-card span {
        color: var(--muted);
        line-height: 1.55;
      }

      .example-card a {
        margin-top: auto;
        color: var(--text);
        font-weight: 700;
        text-decoration-color: var(--accent-2);
        text-decoration-thickness: 2px;
        text-underline-offset: 5px;
      }

      .example-card a:focus-visible {
        outline: 3px solid var(--accent);
        outline-offset: 4px;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero" aria-labelledby="page-title">
        <p class="brand"><span class="brand-mark" aria-hidden="true"></span> Vixeq examples</p>
        <h1 id="page-title">Playback, Timeline, and Arrangement examples</h1>
        <p>
          Release-readiness builds for the official Vixeq examples. These pages are
          published together so browser checks can exercise the same artifacts users open.
        </p>
      </section>
      <section class="grid" aria-label="Published examples">
${cards}
      </section>
    </main>
  </body>
</html>
`;
}

export async function assemblePages({
  rootDir = REPO_ROOT,
  outDir = resolve(rootDir, "_site"),
  targets = pagesTargets,
  pagesBase = inferPagesBase(),
} = {}) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const target of targets) {
    await cp(resolve(rootDir, target.dist), resolve(outDir, target.id), { recursive: true });
  }

  await writeFile(resolve(outDir, "index.html"), renderPagesIndex(targets, pagesBase), "utf8");
}

function parseArgs(argv) {
  const options = { outDir: resolve(REPO_ROOT, "_site") };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out-dir") {
      const next = argv[index + 1];
      if (!next) throw new Error("--out-dir requires a path");
      options.outDir = resolve(REPO_ROOT, next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  assemblePages(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
