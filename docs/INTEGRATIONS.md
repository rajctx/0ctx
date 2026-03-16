# Integrations

0ctx separates:

1. ingestion
2. retrieval

## Ingestion

Ingestion is deterministic. It comes from:

- hooks
- notify integrations
- session-start integrations
- transcript/archive readers

Integrations feed the local daemon. The daemon remains the source of truth.

## Retrieval

Retrieval for supported agents goes through MCP and daemon-backed context packs.

The intended user experience is:

- enable once
- use the agent normally
- get the right workstream context automatically

## GA integrations

### Claude Code

- capture: `Stop`, `SubagentStop`
- startup context: `SessionStart`
- retrieval: MCP + daemon-backed context pack

Official reference:
- https://docs.anthropic.com/en/docs/claude-code/hooks

### Factory / Droid

- capture: `Stop`, `SubagentStop`
- startup context: `SessionStart`
- retrieval: daemon-backed context pack injected on session start

Official references:
- https://docs.factory.ai/cli/configuration/hooks-guide
- https://docs.factory.ai/cli/configuration/hooks/session-automation

### Antigravity

- capture: managed repo hook install
- startup context: session-start integration path
- retrieval: daemon-backed context pack

0ctx treats Antigravity as GA in the current supported path.

## Preview integrations

Preview integrations are supported only when explicitly opted into:

- Codex
- Cursor
- Windsurf

They are intentionally outside the normal product path.

## Product rule

Users should not need to think about:

- `contextId`
- MCP setup details
- hook event internals
- transcript/archive plumbing

The normal product path remains:

```bash
cd <repo>
0ctx enable
```
