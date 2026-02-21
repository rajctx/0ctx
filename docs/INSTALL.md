# Installation Guide

## Prerequisites

- Node.js 22+
- npm 10+
- Local filesystem write access to `~/.0ctx/`

## Option A: Install as a package (preferred once published to your registry)

```bash
npm install -g @0ctx/cli
```

Then run first-time setup:

```bash
0ctx install --clients=all
0ctx doctor --json
0ctx status
```

If `@0ctx/cli` is not yet published in your registry, use Option B.

## Option B: Install from monorepo source (development)

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
