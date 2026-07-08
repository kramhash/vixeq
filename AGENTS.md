# Agent Collaboration

Before working on the pre-1.0 redesign, read
[`docs/plans/v1-collaboration-spec.md`](docs/plans/v1-collaboration-spec.md).
It is the approved source of truth for Playback v2, Timeline/Arrangement v2,
release gates, and migration behavior.

For concurrent Codex/Claude work:

1. Claim a task-table item by setting its owner and status before editing.
2. Do not work on files owned by another in-progress item.
3. Preserve pre-existing and unrelated working-tree changes.
4. Add or update behavioral tests with every implementation change.
5. Stop and record a required decision when implementation conflicts with the
   approved specification; do not silently redefine public behavior.

