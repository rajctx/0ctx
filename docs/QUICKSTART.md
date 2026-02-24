# Quickstart

Get 0ctx running in under 5 minutes.

## 1) Install the CLI

```bash
npm install -g @0ctx/cli
```

> **Developer install (source checkout):** If you are working on the 0ctx source, run `npm install && npm run build` from the repo root and use `node packages/cli/dist/index.js` in place of `0ctx`. See `docs/INSTALL.md` for details.

## 2) Run setup

```bash
0ctx setup --clients=all
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
- `ctx_backup_create`, `ctx_backup_list`, `ctx_backup_restore`

## 5) Common operations

```bash
# Open hosted dashboard URL
0ctx dashboard

# Re-run bootstrap for a specific client
0ctx bootstrap --clients=claude

# Repair daemon + re-register MCP
0ctx repair --clients=all

# Check full system state
0ctx doctor --json

# Start daemon manually (if not auto-started)
0ctx daemon start
```
