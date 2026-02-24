# Installation Guide

## Prerequisites

- Node.js 22+
- npm 10+
- Local filesystem write access to `~/.0ctx/`

## Install from npm

```bash
npm install -g @0ctx/cli
```

Then run first-time setup:

```bash
0ctx setup --clients=all
0ctx connector service status
0ctx connector register --require-cloud
0ctx connector status --json
0ctx connector run --once
0ctx connector queue status --json
0ctx connector queue drain --wait --strict --timeout-ms=120000
0ctx connector queue logs --limit=50
0ctx connector queue logs --clear --dry-run
0ctx doctor --json
0ctx status
```

Drain troubleshooting:
- Use `0ctx connector queue drain --wait --json` and inspect `wait.reason`.
- Common reasons: `drained`, `timeout`, `max_batches`, `bridge_unsupported`, `single_pass`.
- For per-run local audit entries, use `0ctx connector queue logs --limit=50`.
- To clear local ops log safely, use `0ctx connector queue logs --clear --dry-run` first, then `--confirm`.

Service command note:

- Preferred: `0ctx connector service <install|enable|start|stop|restart|status|disable|uninstall>`
- Legacy-compatible: `0ctx daemon service <...>`
- Both command paths target the same underlying managed OS service.

`0ctx setup` runs the canonical onboarding flow: auth check/login, managed runtime startup, MCP bootstrap for supported AI clients, runtime verification, and hosted dashboard handoff.

Compatibility note:

```bash
0ctx install --clients=all
```

still works as an advanced path for daemon + MCP bootstrap only.

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `CTX_DB_PATH` | `~/.0ctx/0ctx.db` | Override SQLite database path |
| `CTX_SOCKET_PATH` | `~/.0ctx/0ctx.sock` (Unix) / `\\.\pipe\0ctx.sock` (Windows) | Override IPC socket path |
| `CTX_MASTER_KEY` | _(reads `~/.0ctx/master.key`)_ | Encryption key for backup payload encryption |
| `CTX_CONNECTOR_STATE_PATH` | `~/.0ctx/connector.json` | Override connector registration state file path |
| `CTX_CONNECTOR_QUEUE_PATH` | `~/.0ctx/connector-event-queue.json` | Override connector event bridge persistent queue path |
| `CTX_CONNECTOR_QUEUE_MAX_ITEMS` | `20000` | Max queued connector events retained on disk before oldest are pruned |
| `CTX_CONNECTOR_QUEUE_MAX_AGE_HOURS` | `168` | Max age (hours) for queued events before pruning |
| `CTX_CLI_OPS_LOG_PATH` | `~/.0ctx/ops.log` | Override local CLI operations audit log path (queue drain/purge actions) |
| `CTX_CONTROL_PLANE_URL` | _(derived from `sync.endpoint`)_ | Override cloud control-plane base URL for connector APIs |
| `CTX_CONTROL_PLANE_TIMEOUT_MS` | `10000` | Connector cloud API timeout in milliseconds |

## Validate Installation

```bash
0ctx doctor --json
```

Expected output:

- `daemon_reachable`: `pass`
- `bootstrap_dry_run`: `pass`
- `db_path`: `pass` or `warn` on first run (created on first write)

## Troubleshooting

**Daemon not reachable:**

```bash
0ctx daemon start
0ctx status
```

**MCP config registration failed:**

```bash
0ctx bootstrap --clients=all
0ctx doctor --json
```

## Contributing / Development Install

If you are working on the 0ctx source:

```bash
git clone https://github.com/0ctx-com/0ctx.git
cd 0ctx
npm install
npm run build
node packages/cli/dist/index.js setup --clients=all --no-open
```

See `AGENTS.md` for build commands and monorepo architecture.
