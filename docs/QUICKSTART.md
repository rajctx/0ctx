# Quickstart

Updated: 2026-02-24

Get 0ctx running in under 5 minutes.

## 1) Install the CLI

```bash
npm install -g @0ctx/cli
```

> **Developer install (source checkout):** If you are working on the 0ctx source, run `npm install && npm run build` from the repo root and use `node packages/cli/dist/index.js` in place of `0ctx`. See `docs/INSTALL.md` for details.

## 2) Run setup

```bash
0ctx setup --clients=all
0ctx setup --clients=all --json
0ctx setup --clients=all --require-cloud --wait-cloud-ready --create-context="Default Workspace"
0ctx setup --clients=all --skip-service --skip-bootstrap --no-open
0ctx setup --clients=all --dashboard-query=source=cli
```

This checks auth, starts/validates the managed local runtime, bootstraps MCP clients (Claude, Cursor, Windsurf), verifies health, and opens the hosted dashboard URL.

## 3) Verify health

```bash
0ctx doctor --json
0ctx status
```

Expected: `daemon_reachable: pass`, `bootstrap_dry_run: pass`.

## 4) Restart your AI client

After bootstrap, restart your AI client (Claude Desktop, Cursor, or Windsurf). Confirm 0ctx tools appear:

- `ctx_create_context`, `ctx_switch_context`, `ctx_list_contexts`
- `ctx_set`, `ctx_get`, `ctx_query`, `ctx_search`
- `ctx_checkpoint`, `ctx_rewind`
- `ctx_health`, `ctx_metrics`, `ctx_audit_recent`
- `ctx_blackboard_state`, `ctx_blackboard_completion`
- `ctx_sync_policy_get`, `ctx_sync_policy_set`
- `ctx_backup_create`, `ctx_backup_list`, `ctx_backup_restore`

## 5) Common operations

```bash
# Open hosted dashboard URL
0ctx dashboard

# Check connector posture
0ctx connector status --json
0ctx connector status --json --require-bridge

# Optional: enforce cloud control-plane registration
0ctx connector register --require-cloud
0ctx connector register --require-cloud --json
0ctx connector verify --require-cloud --json

# Optional: run one connector runtime tick (health + cloud heartbeat)
0ctx connector run --once

# Optional: run local reference control-plane APIs (dev)
npm run dev:control-plane

# Get/set per-context sync policy
0ctx sync policy get --context-id=<contextId>
0ctx sync policy set metadata_only --context-id=<contextId>

# Check managed connector service state
0ctx connector service status

# Open local logs UI (activity + audit + queue + daemon health)
0ctx logs

# Inspect queued event replay state
0ctx connector queue status --json

# Optional: drain queue until empty or timeout
0ctx connector queue drain --wait --strict --timeout-ms=120000

# Optional: inspect local connector queue ops log
0ctx connector queue logs --limit=50

# Optional: clear local queue ops log (safe flow)
0ctx connector queue logs --clear --dry-run
0ctx connector queue logs --clear --confirm

# Notes for drain --wait JSON output:
# wait.reason values:
# - drained: queue reached zero pending events
# - timeout: deadline reached before queue drained
# - max_batches: max batch limit reached for this run
# - bridge_unsupported: cloud ingest endpoint not supported (404 fallback)
# - single_pass: non-wait mode completed one pass

# Re-run bootstrap for a specific client
0ctx bootstrap --clients=claude

# Repair daemon + re-register MCP
0ctx repair --clients=all

# Check full system state
0ctx doctor --json

# Start daemon manually (if not auto-started)
0ctx daemon start
```
