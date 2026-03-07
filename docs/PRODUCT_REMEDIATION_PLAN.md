# 0ctx Product Remediation Plan

## Purpose

Reset 0ctx onto a product path that is coherent, low-maintenance, and distinct.

This is not a "fix bugs and polish UI" plan. It is a direction correction.

## Product Thesis

0ctx should be:

- a local-first project memory runtime
- with deterministic capture from supported agents
- with automatic retrieval into supported agents
- with explicit checkpoints
- with a light desktop management surface

0ctx should not be:

- a generic chat archive
- a graph demo
- a desktop dashboard that users need open all day
- a support-heavy tool that requires repeated repair, refresh, or manual context selection

## Core Product Contract

- `Workspace` = one project or repo
- `Workstream` = one branch or worktree inside a workspace
- `Session` = one captured agent run inside a workstream
- `Message` = one transcript-derived event inside a session
- `Checkpoint` = one durable restore or explain point
- `Insights` = reviewed semantic memory derived from sessions and checkpoints

### Product language changes

Use these names externally:

- `Workspaces`
- `Workstreams`
- `Sessions`
- `Checkpoints`
- `Insights`

Avoid exposing these as user-facing primitives in the main workflow:

- daemon
- connector
- active context
- hidden nodes
- payload sidecars
- recall modes
- sync internals

## Architecture Decision

Use this stack:

- `daemon` = source of truth and state owner
- `MCP` = primary retrieval and control plane for agents
- `hooks / notify / SDK adapters` = ingestion plane only
- `desktop` = management and recovery surface

### Why

- The daemon is the right place for persistence, routing, sync, checkpoints, and isolation.
- MCP is the right standardized surface for agents to fetch and mutate state.
- Hooks and notify integrations are deterministic triggers for capture, but they are not the right long-term retrieval protocol.
- The desktop should not be required for normal use.

## Product Direction Decisions

### 1. Golden path

Replace the current setup flow with a single repo-root command:

- `0ctx enable`

`0ctx enable` should:

- create or bind the workspace from the current repo path
- start or verify the local daemon
- install supported integrations idempotently
- register MCP where relevant
- verify capture readiness
- verify retrieval readiness

The user should not separately need to:

- create a workspace manually
- install integrations manually
- repair or restart for normal first-time use
- pass `--context-id` in daily usage

### 2. Strict routing

Capture must never silently fall back to the active workspace.

Allowed routing modes:

- repo-path match
- explicit override for support or scripting

Disallowed routing mode:

- fallback to active context when path resolution fails

### 3. GA and preview scope

#### GA

- Claude Code
- Factory / Droid
- Antigravity
- MCP retrieval
- checkpoints
- local-first runtime

#### Preview

- Codex
- Cursor
- Windsurf
- automatic semantic insight extraction
- deep branch divergence understanding
- cross-project memory

### 4. Honest branch model

Current branch handling is an organizational projection.

That is acceptable, but product language must stay honest until git-native branch intelligence exists.

Ship as:

- "workstreams grouped by branch or worktree"

Do not ship as:

- "understands branch divergence"
- "understands merge state"

### 5. Honest insight model

Current semantic extraction is useful as assisted curation, not authoritative memory.

Ship it as:

- `Insights`
- `Reviewed insights`

Do not ship it as:

- automatic project understanding
- fully reliable knowledge extraction

### 6. Lean storage and sync policy

Keep local storage rich. Keep cloud sync lean.

Default production policy:

- raw dumps = local only
- transcript history = local only, short retention
- append-only event logs = local only
- normalized messages = local
- checkpoint state = local
- cloud sync = metadata and reviewed insights by default

Do not default to syncing sanitized session payloads upstream.

## Experience Model

### What the user should do

1. `cd repo`
2. `0ctx enable`
3. use a supported agent normally
4. resume work later with the right context already available

### What the user should not do

- manually select contexts for ordinary work
- reopen the desktop just to confirm capture
- run repair commands in the normal path
- understand daemon or sync internals

### Desktop role

Desktop is for:

- seeing workspaces and workstreams
- reading sessions
- managing checkpoints
- reviewing insights
- recovering from problems

Desktop is not the primary interaction surface for successful daily use.

## Agent Retrieval Model

### Primary path

Agents should fetch through MCP.

Needed product-level MCP tools:

- list workstreams
- list sessions for a workstream
- get session detail
- list checkpoints for a workstream
- get checkpoint detail
- get workstream summary
- get recent reviewed insights for a workspace or workstream

### Secondary path

When the host supports session-start context injection, 0ctx should automatically provide a compact summary:

- current workstream
- latest checkpoint
- recent sessions
- reviewed insights

## Cross-context model

Default behavior:

- strict isolation by workspace

Explicit advanced behavior only:

- compare workspaces
- portfolio search
- promote a checkpoint or insight into another workspace

Do not support silent global blending of memory.

## What to Cut or Demote

### Cut from the primary product narrative

- graph-first storytelling
- sync-first storytelling
- repair-first storytelling
- "capture everything forever" storytelling

### Demote in the UI

- Graph
- Setup
- runtime internals
- payload inspection
- storage paths

## Execution Order

### Phase 1: Direction corrections

1. Remove active-context fallback from capture
2. Standardize GA integrations on repo-path routing
3. Re-scope Codex, Cursor, and Windsurf as preview
4. Hide `--context-id` from the normal product path

### Phase 2: Retrieval parity

1. Add workstream/session/checkpoint MCP tools
2. Make agent retrieval match the desktop's product model
3. Add session-start compact context where supported

### Phase 3: Golden path

1. Add `0ctx enable`
2. Make workspace binding automatic from repo root
3. Make integration installation idempotent
4. Make daemon startup implicit and reliable

### Phase 4: Data policy reset

1. Change default sync to lean metadata plus reviewed insights
2. Keep raw dumps local only
3. Add short default retention for transcript history and event logs
4. Keep payload inspection as support-only

### Phase 5: Product UX cleanup

1. Keep desktop focused on workspaces, workstreams, sessions, checkpoints, insights
2. Reduce utilities and internals further
3. Align naming across CLI, daemon, MCP, and desktop

### Phase 6: Future intelligence

1. Add git-native divergence understanding
2. Improve semantic extraction quality
3. Add explicit cross-workspace compare and promotion flows

## Success Criteria

The product is on the right path when:

- a user can enable 0ctx in one command from a repo
- capture lands in the correct workspace with no manual context selection
- supported agents can retrieve the same workstream/session/checkpoint model the desktop shows
- the desktop is optional for successful daily use
- checkpoints are trustworthy and central
- insights are clearly reviewed and not overclaimed
- sync and storage policies feel lean and safe by default
