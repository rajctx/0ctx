# Installation Guide

Updated: 2026-02-24

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
0ctx setup --clients=all --json
0ctx setup --clients=all --require-cloud --wait-cloud-ready --create-context="Default Workspace"
0ctx setup --clients=all --skip-service --skip-bootstrap --no-open
0ctx setup --clients=all --dashboard-query=source=cli
0ctx connector service status
0ctx connector register --require-cloud
0ctx connector register --require-cloud --json
0ctx connector verify --require-cloud --json
0ctx connector status --json
0ctx connector status --json --require-bridge
0ctx connector run --once
# (dev) local reference control-plane service
npm run dev:control-plane
0ctx connector queue status --json
0ctx sync policy get --context-id=<contextId>
0ctx sync policy set metadata_only --context-id=<contextId>
0ctx version
0ctx --version
0ctx logs
0ctx connector queue drain --wait --strict --timeout-ms=120000
0ctx connector queue logs --limit=50
0ctx connector queue logs --clear --dry-run
0ctx doctor --json
0ctx status
```

Drain troubleshooting:
- Use `0ctx connector queue drain --wait --json` and inspect `wait.reason`.
- Common reasons: `drained`, `timeout`, `max_batches`, `bridge_unsupported`, `single_pass`.
- For local command activity + runtime/audit visibility, use `0ctx logs`.
- For queue operation history, use `0ctx connector queue logs --limit=50`.
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

See `docs/ENV_REFERENCE.md` for the canonical env-var contract covering hosted UI, BFF, and local runtime.

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
0ctx bootstrap --clients=all --dry-run
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
