# Agent Collaboration

Before working on the pre-1.0 redesign, read
[`docs/plans/v1-collaboration-spec.md`](docs/plans/v1-collaboration-spec.md).
It is the approved source of truth for Playback v2, Timeline/Arrangement v2,
release gates, and migration behavior.

## Where work is tracked

- **The 1.0 release work** (RC2, RC3, S1, and the other rows already in the
  spec's task table) stays in that table until `1.0.0` ships.
- **New work** (fixes, additions, and requests found after 0.9, including the
  frapx integration findings) is tracked as GitHub issues. Milestones give the
  release: `1.0.0-rc.1` for items that must land before the RC (these also
  have a reference row in the task table), `1.0.0` for items that must land
  during the RC observation period, before the stable publish (S1), `1.1.0`
  for additive follow-ups, and no milestone for later.
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
