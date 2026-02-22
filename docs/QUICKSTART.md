# Quickstart

## 0) Ensure CLI is available

Use one of:

- Packaged install (when registry publishing is available for your org):

```bash
npm install -g @0ctx/cli
```

- Monorepo fallback:

```bash
npm install
npm run build
```

See `docs/INSTALL.md` for full setup details.

## 1) Install and bootstrap

```bash
0ctx install --clients=all
```

This starts the daemon (if needed), registers MCP config for supported clients, and prints status.

## 2) Check health

```bash
0ctx doctor --json
0ctx status
```

## 3) Start MCP server

If you are running from the monorepo:

```bash
npm run start:mcp
```

## 4) Open UI (monorepo/developer flow)

```bash
npm run dev:ui
```

Open `http://localhost:3000`.

Dashboard routes:

- `/dashboard/workspace`
- `/dashboard/operations`
- `/dashboard/audit`
- `/dashboard/backups`

## 5) Verify MCP from your AI client

After bootstrap, restart the AI client and confirm 0ctx tools appear:

- `ctx_list_contexts`
- `ctx_create_context`
- `ctx_switch_context`
- `ctx_set`
- `ctx_get`
- `ctx_query`
- `ctx_search`
- `ctx_checkpoint`
- `ctx_rewind`

## Common Operations

- `0ctx bootstrap --dry-run --clients=all`
- `0ctx repair --clients=all`
- `0ctx daemon start`
