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
0ctx install --clients=all
0ctx doctor --json
0ctx status
```

`0ctx install` starts the daemon (if not already running), registers the MCP server with all supported AI clients (Claude, Cursor, Windsurf), and prints a status summary.

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `CTX_DB_PATH` | `~/.0ctx/0ctx.db` | Override SQLite database path |
| `CTX_SOCKET_PATH` | `~/.0ctx/0ctx.sock` (Unix) / `\\.\pipe\0ctx.sock` (Windows) | Override IPC socket path |
| `CTX_MASTER_KEY` | _(reads `~/.0ctx/master.key`)_ | Encryption key for backup payload encryption |

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
node packages/cli/dist/index.js install --clients=all
```

See `AGENTS.md` for build commands and monorepo architecture.
