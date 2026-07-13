# Migration Guides

This directory collects public migration notes for breaking pre-1.0 changes.
Each guide is tied to the release line that introduced the change.

| Release | Guide | Scope |
| --- | --- | --- |
| 0.7 | [`0.7-playback-v2.md`](./0.7-playback-v2.md) | PlaybackTransport, async controls, sampling, and React hook playback behavior. |
| 0.8 | [`0.8-timeline-arrangement-v2.md`](./0.8-timeline-arrangement-v2.md) | TimingMap v2, TimelineProject v2, ArrangementProject v2, and v1-to-v2 migration APIs. |
| 0.9 | [`0.9-react-render-frugal.md`](./0.9-react-render-frugal.md) | React hook `latestEvent` state replaced by `latestEventRef`. |

Breaking changes before `1.0.0` must be documented here or in an equivalent
release-specific migration note linked from `CHANGELOG.md`.
