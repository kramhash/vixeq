# Agent Collaboration

[`docs/plans/v1-collaboration-spec.md`](docs/plans/v1-collaboration-spec.md)
is the approved contract for the 1.0 API: Playback v2, Timeline/Arrangement
v2, release gates, and migration behavior. Read it before changing Engine
behavior, and keep 1.x changes within the semver policy in `SUPPORT.md`.

## Where work is tracked

- **All work** is tracked as GitHub issues. The spec's task table recorded
  the 1.0 release work and closed with S1; do not add rows to it.
- Milestones give the release: `1.0.x` for fixes that change no public API,
  `1.1.0`–`1.3.0` for the additive follow-ups in `ROADMAP.md`, and no
  milestone for later.
- Issue bodies use the headings Problem / What exists / Proposed change /
  Tests / Release notes, plus Evidence and Depends on / Order when they apply.
  The cross-repository plan for the frapx integration issues is
  [`docs/frapx_vixeq_integration.md`](https://github.com/kramhash/frapx/blob/main/docs/frapx_vixeq_integration.md)
  in the frapx repository.

## Concurrent Codex/Claude work

1. Claim before editing: set the owner and status of a task-table item, or
   assign the issue to yourself / comment that you are taking it.
2. Do not work on files owned by another in-progress item or claimed issue.
3. Preserve pre-existing and unrelated working-tree changes.
4. Add or update behavioral tests with every implementation change.
5. Stop and record a required decision when implementation conflicts with the
   approved specification; do not silently redefine public behavior. Items
   marked "Decide …" in an issue need a proposal and the user's confirmation
   before implementation.
6. One issue per PR; the PR body says `Closes #N`. Line numbers under an
   issue's "What exists" are as of filing; re-read the current code when they
   drift.
