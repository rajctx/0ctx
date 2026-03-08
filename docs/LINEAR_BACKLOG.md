# Linear Backlog

Tracked in Linear under project `0ctx Product Remediation`:

- `0CT-5` Product Contract Reset — `Done`
- `0CT-6` Agent Retrieval Parity via MCP — `In Progress`
- `0CT-7` Repo-Root Enablement Golden Path — `Done`
- `0CT-8` Lean Local Data Policy — `In Progress`
- `0CT-9` Desktop as Management Surface — `In Progress`
- `0CT-10` Honest Memory and Git-Aware Workstreams — `In Progress`

## Current execution order

1. `0CT-6` Agent Retrieval Parity via MCP
2. `0CT-8` Lean Local Data Policy
3. `0CT-9` Desktop as Management Surface
4. `0CT-10` Honest Memory and Git-Aware Workstreams
5. Future follow-on: explicit cross-workspace compare/promotion

## Issue status notes

## 0CT-6 Agent Retrieval Parity via MCP

Delivered:

- MCP exposes workstream/session/checkpoint retrieval and control primitives
- daemon-backed `getWorkstreamBrief`
- daemon-backed `getAgentContextPack`
- SessionStart injection for Claude / Factory / Antigravity
- workstream/session/checkpoint retrieval aligns better with desktop

Still open:

- make retrieval feel invisible to the user
- keep preview integrations out of the normal supported guidance everywhere
- reduce residual MCP/setup thinking in the golden path

## 0CT-8 Lean Local Data Policy

Delivered:

- default sync policy is now `metadata_only`
- `nodePayloads` no longer upload
- checkpoint payloads remain excluded
- retention tightened for transcript history and event logs
- payload/debug data is increasingly utility-only

Still open:

- finalize the product default story for sync
- finish retention/config UX
- keep raw payload access out of the normal user path everywhere

## 0CT-9 Desktop as Management Surface

Delivered:

- desktop no longer needs to be open for capture/retrieval
- event-driven refresh reduced constant polling
- support/debug surfaces are demoted
- primary screens are more focused on workspaces/workstreams/sessions/checkpoints/insights

Still open:

- validate real captured workflows end to end
- remove more residual maintenance/operator concepts from daily surfaces
- keep utilities secondary in both layout and copy

## 0CT-10 Honest Memory and Git-Aware Workstreams

Delivered:

- compare output includes merge base and ahead/behind
- detached HEAD is represented honestly
- capture drift is represented honestly
- workstream detail is more truthful across daemon/CLI/desktop

Still open:

- strengthen git-native reasoning beyond compare
- improve reviewed-insight quality
- add explicit cross-workspace compare/promotion

## Next updates to make in Linear

1. attach the refreshed remediation plan as a project document
2. keep issue descriptions aligned with actual delivered scope
3. close issues only when the product path, not just the implementation slice, is actually complete
