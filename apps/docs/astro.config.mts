import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";

// Mirrors scripts/build-pages.mjs's inferPagesBase so the docs base tracks
// the same repository-name derivation as the rest of the Pages index instead
// of hardcoding "/vixeq".
function resolveDocsBase() {
  if (process.env.VIXEQ_BASE_PATH !== undefined)
    return process.env.VIXEQ_BASE_PATH;
  if (process.env.GITHUB_ACTIONS !== "true") return "/";
  const repository = process.env.GITHUB_REPOSITORY;
  const name = repository?.includes("/")
    ? repository.split("/").at(-1)
    : "vixeq";
  return `/${name}/docs`;
}

export default defineConfig({
  base: resolveDocsBase(),

  integrations: [
    starlight({
      title: "Vixeq",
      description: "Signal sequencer for the web — guides and API reference.",
      logo: {
        light: "./src/assets/vixeq-logo-light.svg",
        dark: "./src/assets/vixeq-logo.svg",
        replacesTitle: true,
      },
      customCss: ["./src/styles/custom.css"],
      social: [
        {
          icon: "github",
          href: "https://github.com/kramhash/vixeq",
          label: "GitHub",
        },
      ],

      sidebar: [
        {
          label: "Guide",
          items: [
            { label: "Tutorial", link: "/guide/tutorial/" },
            { label: "Rhythm game", link: "/guide/rhythm-game/" },
            { label: "Concepts", link: "/guide/concepts/" },
            { label: "@vixeq/core", link: "/guide/core/" },
            { label: "@vixeq/react", link: "/guide/react/" },
            { label: "@vixeq/player-react", link: "/guide/player-react/" },
          ],
        },
        typeDocSidebarGroup,
      ],

      plugins: [
        starlightTypeDoc({
          entryPoints: [
            "../../packages/core",
            "../../packages/react",
            "../../packages/player-react",
          ],
          // Per-package packages/{core,react,player-react}/typedoc.json define each
          // package's own entryPoints (core has two: index.ts + dom.ts).
          typeDoc: {
            entryPointStrategy: "packages",
            readme: "none",
            excludePrivate: true,
            excludeInternal: true,
            excludeExternals: true,
          },
        }),
      ],
    }),
  ],
});
