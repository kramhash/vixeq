import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";

// Mirrors the base-path branching in apps/playground/vite.config.ts so the
// docs site resolves correctly both in local dev and under GitHub Pages,
// where it is published alongside the playground at /vixeq/docs/.
const isGithubActions = process.env.GITHUB_ACTIONS === "true";

export default defineConfig({
  base: isGithubActions ? "/vixeq/docs" : "/",

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
      social: [{ icon: "github", href: "https://github.com/kramhash/vixeq", label: "GitHub" }],

      sidebar: [
        {
          label: "Guide",
          items: [
            { label: "Tutorial", link: "/guide/tutorial/" },
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
          entryPoints: ["../../packages/core", "../../packages/react", "../../packages/player-react"],
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
