# Vixeq Support Policy

This policy defines the support, compatibility, and semver rules for the
pre-1.0 release-readiness line and the 1.0 API freeze.

## Supported Versions

Vixeq packages are released in lockstep. `@vixeq/core`, `@vixeq/react`, and
`@vixeq/player-react` use the same version number for every public release.

| Release line | Status | Notes |
| --- | --- | --- |
| `0.9.x` | release-readiness | Final pre-1.0 gates, support docs, and migration docs. |
| `1.0.0-rc.x` | release candidate | Published only after all 0.7-0.9 gates are green. |
| `1.0.x` | stable | API freeze line after the RC observation period. |
| `<0.9` | migration source | Documented for upgrades, but not the active support line. |

## Runtime Support Matrix

The 1.0 support target is:

| Area | Supported range |
| --- | --- |
| Node.js | `22`, `24`, and `26` |
| React | `>=18 <20` for `@vixeq/react` and `@vixeq/player-react` peers |
| TypeScript | `>=5.5` (verified on `5.5`, `6.0`, and `7.0`) |
| Module formats | ESM and CJS consumers |
| SSR | Package imports must not require browser globals at module evaluation |
| Package CSS | `@vixeq/player-react/styles.css` must resolve from the packed package |

Node 20 is not part of the 1.0 support target.

## Browser Support

Browser support is defined by the browsers bundled with the locked Playwright
release used by this repository. For `@playwright/test@1.64.0`, the recorded
browser set is:

| Browser project | Bundled browser |
| --- | --- |
| `chromium` | Chrome for Testing `156.0.8078.4` (`chromium` revision `1248`) |
| `firefox` | Firefox `157.0` (`firefox` revision `1555`) |
| `webkit` | WebKit `27.2` (`webkit` revision `2370`) |

The browser gate runs desktop Chromium, Firefox, and WebKit. Mobile viewport
behavior is covered by product/example verification when a browser-facing
change needs it, but mobile browser engines are not a separate support target
for 1.0.

Known headless WebAudio caveat: Linux headless WebKit and Firefox do not
reliably start or advance `AudioContext.currentTime` in Playwright for the
real WebAudio product E2E case. Both browsers remain in the browser matrix,
but real WebAudio playback start/progression assertions capability-skip when
that environment cannot start or advance the audio clock. Deterministic
transport behavior still runs in WebKit and Firefox.

## Compatibility Gates

Every release candidate and stable release must pass the relevant repository
gates before publishing:

```sh
pnpm typecheck
pnpm build
pnpm test
pnpm api:check
pnpm behavior:check
pnpm smoke:pack
pnpm test:e2e
```

Additional compatibility fixtures:

```sh
SMOKE_REACT_VERSION=18 pnpm smoke:pack
SMOKE_TS_VERSION=5.5 pnpm smoke:pack
SMOKE_TS_VERSION=7.0 pnpm smoke:pack
```

`pnpm test:coverage` enforces the configured package thresholds and runs in CI
on the Node 22 build leg.

## Semver Policy

Before `1.0.0`, Vixeq may make breaking public API changes in minor releases
when the change is required to reach the approved 1.0 contract. These changes
must be documented in `CHANGELOG.md` and accompanied by a migration guide or
explicit migration notes.

After `1.0.0`:

- Patch releases contain bug fixes, documentation corrections, and compatible
  packaging fixes.
- Minor releases add backward-compatible APIs, examples, or optional behavior.
- Major releases are required for breaking public API changes, support-matrix
  removals, export removals, or semantic behavior changes that existing
  consumers cannot adopt without code changes.

What counts as public API:

- Everything exported from a package entry point (`@vixeq/core`,
  `@vixeq/core/dom`, `@vixeq/react`, `@vixeq/player-react`, and
  `@vixeq/player-react/styles.css`) is public. There are no release tiers
  such as `@beta` or `@internal`.
- Projects passed in, and projects and presets handed out (`presets`,
  `getProject()`, event payloads), are treated as immutable. `presets` is
  frozen; mutating any other project in place is unsupported, and a change
  in what such a mutation does is not a breaking change. The editing
  helpers return new projects.

Unions and payloads that Vixeq emits can grow in a minor release. Handle
unknown values with a default branch instead of an exhaustive `switch` that
fails to compile when a value is added. This covers, among others:

- `PlaybackState`
- `EnginePlaybackEvent.type` and `EnginePlaybackCause`
- `StepEventCause`
- `PlaybackErrorCode`
- `PlaybackTransportEvent`
- `ListenerErrorContext.source`
- `SequencePlayerChangeReason`
- the hooks' pending-operation unions

Fields added to emitted event payloads and snapshots are also minor.

Some types are contracts that consumers implement: `PlaybackTransport`,
`PlaybackClock`, `ChannelSource`, `Envelope`, and `TimelineEventValidator`.
In 1.x they gain only optional members; adding a required member is a major
change. New engine capabilities, such as the duration getters planned for
1.1, go on the engine classes, not on `ChannelSource`.

Public API changes must update the affected API Extractor report in the same
change as the implementation.

## Migration Policy

Migration documentation is part of the public contract for breaking changes.
The current migration guides are:

- [`docs/migrations/0.7-playback-v2.md`](./docs/migrations/0.7-playback-v2.md)
- [`docs/migrations/0.8-timeline-arrangement-v2.md`](./docs/migrations/0.8-timeline-arrangement-v2.md)
- [`docs/migrations/0.9-react-render-frugal.md`](./docs/migrations/0.9-react-render-frugal.md)

Migration functions reject invalid or ambiguous input instead of silently
inventing domain meaning. When a required v2 value cannot be derived safely,
the migration must either require an explicit caller option or return
`ok: false` with issue details.
