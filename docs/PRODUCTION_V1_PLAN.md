# 0ctx Production V1

## Product Contract

- `Workspace`: one project or repository.
- `Branch lane`: one branch or worktree inside a workspace.
- `Agent session`: one captured run from one agent in one branch lane.
- `Message`: one transcript-derived event inside a session.
- `Checkpoint`: a first-class restore and explain unit linked to a branch lane, session, and commit.
- `Knowledge`: derived decisions, constraints, goals, assumptions, questions, and artifacts extracted from sessions and checkpoints.

## V1 Defaults

- Local-first runtime: SQLite + daemon are the source of truth.
- Hosted surface is secondary and does not need desktop parity for launch.
- New workspaces default to `full_sync`.
- Windows and macOS are GA desktop targets.
- Linux ships as preview.
- GA agent adapters:
  - Factory / Droid
  - Codex
  - Antigravity

## Canonical Capture Pipeline

1. Hook event arrives from the agent.
2. Raw hook event is appended to local event storage.
3. Transcript snapshot and transcript history are written locally.
4. Transcript messages are normalized into session and message records.
5. Session rollups update branch-lane projections.
6. Checkpoints link branch, session, agent, and commit state.
7. Knowledge extraction derives graph nodes from captured work.

Hook envelopes are metadata only. Transcript-derived messages are the source of truth.

## Current Implementation Scope

### Completed in the production-foundation slice

- Schema v8:
  - `checkpoint_payloads`
  - `branch_lanes`
  - enriched checkpoint metadata columns
- Branch-lane projection queries in core.
- First-class checkpoint detail, rewind, resume, and explain methods.
- Daemon APIs for:
  - `listBranchLanes`
  - `listBranchSessions`
  - `listSessionMessages`
  - `listBranchCheckpoints`
  - `getSessionDetail`
  - `getCheckpointDetail`
  - `getHandoffTimeline`
  - `createSessionCheckpoint`
  - `resumeSession`
  - `rewindCheckpoint`
  - `explainCheckpoint`
- CLI surfaces for:
  - `0ctx branches`
  - `0ctx sessions`
  - `0ctx checkpoints`
  - `0ctx resume`
  - `0ctx rewind`
  - `0ctx explain`
- Desktop branch-first navigation:
  - `Workspaces`
  - `Branches`
  - `Sessions`
  - `Checkpoints`
  - `Knowledge`
  - `Setup`

### Next slices

- Redaction before cloud-bound full sync.
- Cross-agent handoff improvements beyond timeline rollups.
- Product-grade `doctor`, `reset`, `resume`, and `rewind` UX polish.
- Packaging and updater smoke automation for Windows/macOS.
- Codex adapter normalization on the same transcript contract as Factory and Antigravity.

## Release Gates

- `npm run build`
- `npm run test`
- `npm run release:e2e:ga`
- migration rehearsal from pre-v8 local data
- one real end-to-end capture per GA agent
- desktop smoke on Windows and macOS
- `npm run release:desktop:artifacts`
