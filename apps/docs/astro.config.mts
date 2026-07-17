import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";
import starlightLinksValidator from "starlight-links-validator";

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
          //
          // readme must be explicitly set to "" (not omitted) to enable
          // per-package README pages: starlight-typedoc's own internal
          // defaults force `readme: "none"` regardless of TypeDoc's own
          // default, so simply omitting this key leaves READMEs disabled.
          // The generated packages index (api/README.md) links to each
          // package's `.../readme/` route; without this, that route 404s on
          // the deployed Pages site because the page is never generated.
          typeDoc: {
            entryPointStrategy: "packages",
            readme: "",
            excludePrivate: true,
            excludeInternal: true,
            excludeExternals: true,
          },
        }),
        // Fails the build on broken internal links/anchors so link-hierarchy
        // mistakes (e.g. the api/README.md 404 above) are caught before deploy
        // instead of surfacing as a 404 on the live Pages site.
        //
        // errorOnRelativeLinks is disabled because hand-authored guide/index
        // pages intentionally use relative links (e.g. `../core/`) rather
        // than root-absolute ones: Starlight does not rewrite root-absolute
        // markdown/frontmatter links to include the deployed `base`
        // (`/<repo>/docs` in CI), so root-absolute links 404 on Pages while
        // relative links resolve correctly regardless of base.
        starlightLinksValidator({ errorOnRelativeLinks: false }),
      ],
    }),
  ],
});
