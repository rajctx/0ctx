# Installation Guide

Canonical roadmap/tracker:
- `docs/ENTERPRISE_ROADMAP_AND_TRACKER.md`

## Prerequisites

- Node.js 22+
- npm 10+
- Local filesystem write access to `~/.0ctx/`

## Option A: Install from npm (target no-clone path)

```bash
npm install -g @0ctx/cli
```

Then run first-time setup:

```bash
0ctx install --clients=all
0ctx doctor --json
0ctx status
```

If `@0ctx/cli` is not available on npm yet, use Option B.

## Option B: Install from monorepo source (current fallback)

```bash
npm install
npm run build
npm run cli -- install --clients=all
```

## Environment Variables

- `CTX_DB_PATH`: override SQLite path (default `~/.0ctx/0ctx.db`)
- `CTX_SOCKET_PATH`: override socket/pipe path
- `CTX_MASTER_KEY`: encryption key override for backup payload encryption

## Validate Installation

```bash
0ctx doctor --json
```

Expected:

- `daemon_reachable`: `pass`
- `bootstrap_dry_run`: `pass`
- `db_path`: `pass` or `warn` on first run

## Current Productization Status

- No-clone packaged installation is the target enterprise experience.
- If package publishing is not yet active in your environment, continue with Option B until release/publish milestones are completed.

## Troubleshooting

If daemon is not reachable:

```bash
0ctx daemon start
0ctx status
```

If MCP config registration fails:

```bash
0ctx bootstrap --clients=all
0ctx doctor --json
```
