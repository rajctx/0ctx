# 0ctx Product Remediation Plan

## Purpose

Reset 0ctx onto a coherent product path:

- low maintenance for the user
- strict project-scoped memory
- daemon-owned state
- MCP-first agent retrieval
- desktop as a management surface, not a daily dependency

This is the live execution plan for the remaining work.

## Product Contract

- `Workspace` = one project or repo
- `Workstream` = one branch or worktree inside a workspace
- `Session` = one captured agent run inside a workstream
- `Message` = one transcript-derived event inside a session
- `Checkpoint` = one durable restore or explain point
- `Insights` = reviewed semantic memory derived from sessions and checkpoints

Externally, the product should talk in terms of:

- Workspaces
- Workstreams
- Sessions
- Checkpoints
- Insights

The product should not force users to think about:

- daemon
- connector
- active context
- hidden nodes
- payload sidecars
- recall modes
- sync internals

## Architecture Decision

Keep this stack:

- `daemon` = source of truth and runtime owner
- `MCP` = primary agent-facing retrieval and control plane
- `hooks / notify / SDK adapters` = ingestion only
- `desktop` = management and recovery surface

## Current Status

### Done

1. Product contract reset
   - no normal-path active-context fallback
   - repo-root-first daily flow
   - preview integrations kept out of default install/bootstrap paths
   - user-facing `workstream` language adopted broadly

2. Repo-root golden path
   - `0ctx enable`
   - daemon/bootstrap/integration readiness from repo root

3. MCP retrieval parity foundation
   - workstream/session/checkpoint tools exist
   - daemon-backed `getWorkstreamBrief`
   - daemon-backed `getAgentContextPack`
   - SessionStart injection wired for Claude, Factory, Antigravity

4. Leaner sync/storage baseline
   - default sync policy is now `metadata_only`
   - `nodePayloads` are no longer uploaded
   - retention defaults tightened for debug artifacts

5. Honest workstream baseline
   - workstream compare exists
   - merge base / ahead / behind are exposed
   - detached HEAD and capture drift are represented honestly

### In Progress

1. Agent retrieval ergonomics
2. Lean data policy finalization
3. Desktop as management surface
4. Honest memory and git-aware workstreams

### Not Started Enough

1. Cross-workspace compare and promotion
2. Better reviewed-insight quality
3. Final GA vs preview cleanup across every remaining surface

## Remaining Work

## Milestone 1: Invisible Supported-Agent Retrieval

### Goal

For GA integrations, users should not need to think about MCP or SessionStart mechanics.

### Scope

1. Make `0ctx enable` the only normal instruction for supported agents
2. Ensure supported agents always receive the current workstream pack automatically when the host supports it
3. Keep MCP as the retrieval layer, but hide that fact in user-facing guidance
4. Keep preview integrations out of the supported setup narrative

### Deliverables

1. CLI help and onboarding reduced to:
   - `cd repo`
   - `0ctx enable`
   - use the supported agent normally
2. Desktop setup copy only references GA integrations by default
3. MCP/bootstrap commands remain available but clearly secondary

### Acceptance

1. A new user can enable the repo without learning MCP
2. Claude / Factory / Antigravity get current workstream context automatically
3. No default command path suggests preview integrations

## Milestone 2: Lean Data Policy Finalization

### Goal

Make local storage rich but bounded, and make cloud behavior lean by default.

### Scope

1. Confirm `metadata_only` as the production default
2. Make payload inspection clearly utility-only everywhere
3. Tighten retention/config UX into one story
4. Remove or demote any remaining default path that suggests raw payloads are part of normal use

### Deliverables

1. Clear sync policy copy in CLI and desktop
2. One retention story for:
   - raw dumps
   - transcript history
   - append-only event logs
3. Utility-only access to debug payloads

### Acceptance

1. Default users do not upload rich session payloads by accident
2. Local debug artifacts prune automatically
3. Payload inspection is never part of the normal product narrative

## Milestone 3: Desktop as Management Surface

### Goal

Make desktop optional for daily success and cleaner for management.

### Scope

1. Remove remaining operator/support-first language from primary views
2. Validate real flows with captured data, not just empty states
3. Keep utilities secondary and non-blocking

### Deliverables

1. Normal views focus only on:
   - Workspaces
   - Workstreams
   - Sessions
   - Checkpoints
   - Insights
2. Utilities stay available but visually and conceptually secondary
3. Desktop reacts to daemon events instead of acting like a polling dashboard

### Acceptance

1. Capture and retrieval work without desktop open
2. Desktop is useful for management, not required for success
3. Real captured projects remain readable without debug knowledge

## Milestone 4: Honest Git-Aware Workstreams

### Goal

Move from grouped branch metadata to stronger git-native workstream understanding.

### Scope

1. Keep compare truthful and useful
2. Add stronger workstream state:
   - detached HEAD
   - capture drift
   - branch/worktree truth
3. Improve how checkpoints and handoffs explain git context

### Deliverables

1. Better workstream brief and compare output
2. Better desktop/CLI workstream detail
3. Clear distinction between:
   - current checkout
   - last captured commit
   - upstream state

### Acceptance

1. Users can tell whether capture is behind the current checkout
2. Detached HEAD is represented honestly
3. Compare is not overclaimed as full branch intelligence

## Milestone 5: Insights Quality and Cross-Workspace Promotion

### Goal

Keep insights honest, reviewed, and actually useful across projects.

### Scope

1. Improve reviewed-insight quality without overclaiming
2. Add explicit compare/promote flows across workspaces
3. Keep cross-workspace memory opt-in and explicit

### Deliverables

1. Better insight preview and approval flow
2. Explicit compare/promote operations across workspaces
3. No silent cross-project blending

### Acceptance

1. Insights remain reviewable and non-magical
2. Cross-workspace reuse is explicit
3. Product language stays honest

## Execution Order

1. Milestone 1: Invisible Supported-Agent Retrieval
2. Milestone 2: Lean Data Policy Finalization
3. Milestone 3: Desktop as Management Surface
4. Milestone 4: Honest Git-Aware Workstreams
5. Milestone 5: Insights Quality and Cross-Workspace Promotion

## Non-Goals

Do not spend roadmap time on:

- making preview integrations feel GA
- graph-first storytelling
- rich cloud sync as a default
- keeping legacy operator flows alive for unreleased behavior

## Release Gate

The remediation phase is complete when:

1. `0ctx enable` is the only normal first-run instruction
2. supported agents retrieve the right workstream context automatically
3. sync/storage defaults are lean and safe
4. desktop is optional for daily use
5. workstream/git state is honest
6. insights are clearly reviewed, not overclaimed
