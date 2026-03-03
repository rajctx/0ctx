# AGENTS.md

This file provides implementation guidance when working in this repository.

## Project Overview

0ctx is a persistent, local-first, graph-based context engine that eliminates context loss across AI tool switches.  
It stores a knowledge graph in SQLite and exposes operations through a local daemon plus MCP tools.

The system is domain-agnostic and built for developer and non-developer workflows.

## Build, Check, and Test Commands

```bash
# Install all workspace dependencies
npm install

# Build all TypeScript packages (core -> daemon -> mcp)
npm run build

# Static typecheck using project references
npm run typecheck

# Run automated tests (Vitest)
npm run test

# Run daemon in dev mode
npm run dev

# Run CLI in dev mode
npm run dev:cli

# CLI release pipeline (single command)
0ctx release publish --version vX.Y.Z --dry-run

# Start MCP server (build required first)
npm run start:mcp

# Auto-register 0ctx MCP in detected AI client configs
npm run bootstrap:mcp

# Preview MCP registration changes without writing files
npm run bootstrap:mcp:dry

# Run local UI (contributor/dev only; end-user runtime uses hosted UI)
npm run dev:ui

# Lint packages
npm run lint

# Detect nested git repositories under this monorepo
npm run repo:check-nested-git

# Preview and apply migration of packages/ui nested git into monorepo
npm run repo:adopt-ui:dry
npm run repo:adopt-ui
```

## Monorepo Architecture

This is an npm workspaces monorepo. Build/reference order matters:

**`packages/core` -> `packages/daemon` -> `packages/mcp`**  
`packages/cli` depends on daemon + mcp.  
(`packages/ui` is independent from the TypeScript reference chain)

### `packages/core` (`@0ctx/core`)

Pure graph and persistence logic.

- `src/schema.ts`:
  - Domain model (`ContextNode`, `ContextEdge`, `Checkpoint`, `Context`)
  - Audit model (`AuditEntry`, `AuditAction`, `AuditMetadata`)
  - Backup model (`ContextDump`)
- `src/db.ts`:
  - SQLite opening and schema migrations
  - `schema_meta` version tracking (`CURRENT_SCHEMA_VERSION`)
  - Tables include `contexts`, `nodes`, `edges`, `checkpoints`, `nodes_fts`, `audit_logs`
- `src/graph.ts`:
  - Core CRUD/query/checkpoint logic
  - Audit APIs (`recordAuditEvent`, `listAuditEvents`)
  - Backup APIs (`exportContextDump`, `importContextDump`)
- `src/encryption.ts`:
  - AES-256-GCM JSON payload encryption/decryption helpers
  - Key resolution from `CTX_MASTER_KEY` or `~/.0ctx/master.key`

### `packages/daemon` (`@0ctx/daemon`)

Persistent local process owning DB access, IPC protocol, and operational features.

- `src/server.ts`:
  - Named pipe / Unix socket server
  - Request parsing and response framing
  - Structured request logging and metrics recording
- `src/handlers.ts`:
  - Main request dispatch for all daemon methods
  - Session-aware context resolution
  - Audit event writes for mutating operations
  - Backup/restore endpoints
- `src/resolver.ts`:
  - Session token and connection context state
- `src/metrics.ts`:
  - In-memory request counters and latency snapshots
- `src/logger.ts`:
  - JSON structured logs
- `src/backup.ts`:
  - Encrypted backup file write/read/list helpers

### `packages/mcp` (`@0ctx/mcp`)

MCP stdio server translating tool calls into daemon IPC calls.

- `src/client.ts`:
  - Per-request socket client
  - Protocol envelope support (`requestId`, `sessionToken`, `apiVersion`)
- `src/index.ts`:
  - MCP handlers
  - Local session bootstrap and context tracking
- `src/tools.ts`:
  - Context graph tools plus enterprise operations (`ctx_health`, `ctx_metrics`, sync-policy, audit, and backup tools)
- `src/bootstrap.ts`:
  - Auto-registration CLI for MCP clients (Claude/Cursor/Windsurf)
  - Idempotent merge into client `mcpServers` config

### `packages/cli` (`@0ctx/cli`)

Product-facing command-line surface for install and support workflows.

- `src/index.ts`:
  - Commands: `shell`, `install`, `bootstrap`, `doctor`, `status`, `repair`, `daemon start`, `release publish`
  - Runs daemon health checks and startup flow
  - Uses MCP bootstrap registration for supported clients
  - Provides diagnostics output (human + JSON)

### `packages/ui` (`@0ctx/ui`)

Next.js hosted UI codebase (dev/contributor surface). End-user runtime is hosted UI plus local connector/daemon.

## Key Design Constraints

- Local-first always: local daemon + SQLite are primary.
- SQLite-only for local product (no local Postgres dependency).
- Strict context isolation by `contextId`.
- MCP server remains stateless; daemon owns state.
- Graph is append-mostly: prefer supersession relationships over destructive edits where practical.
- Universal node taxonomy only:
  - `background`, `decision`, `constraint`, `goal`, `assumption`, `open_question`, `artifact`

## IPC Protocol (Current)

All daemon communication uses newline-delimited JSON over socket/pipe.

Request shape:

```json
{ "method": "<method>", "params": { ... }, "requestId": "...", "sessionToken": "...", "apiVersion": "2" }
```

Response shape:

```json
{ "ok": true, "result": ..., "requestId": "..." }
```

or

```json
{ "ok": false, "error": "..." }
```

### Session and Context Notes

- MCP uses short-lived socket connections, so context continuity is maintained through daemon session tokens.
- Context can be provided explicitly via `params.contextId` or resolved from active session state.
- Prefer explicit `contextId` on context-bound operations when building new clients/integrations.

## Daemon Methods (High-Value)

Context/session:

- `createSession`
- `refreshSession`
- `listContexts`
- `createContext`
- `switchContext`
- `getActiveContext`
- `deleteContext`

CLI/support:

- `0ctx install`
- `0ctx shell`
- `0ctx bootstrap`
- `0ctx doctor`
- `0ctx status`
- `0ctx repair`
- `0ctx release publish`

Graph:

- `addNode`, `getNode`, `updateNode`, `deleteNode`
- `addEdge`
- `getByKey`, `search`, `getSubgraph`, `getGraphData`
- `saveCheckpoint`, `listCheckpoints`, `rewind`

Enterprise/ops:

- `health`
- `metricsSnapshot`
- `syncStatus`
- `syncNow`
- `getSyncPolicy`
- `setSyncPolicy`
- `getCapabilities`
- `evaluateCompletion`
- `listAuditEvents`
- `createBackup`
- `listBackups`
- `restoreBackup`

## Data Storage

Local state under `~/.0ctx/`:

- `0ctx.db` - SQLite database (WAL mode, foreign keys enabled)
- `0ctx.sock` - Unix domain socket (or `\\.\pipe\0ctx.sock` on Windows)
- `master.key` - local encryption key fallback (when `CTX_MASTER_KEY` is not provided)
- `connector.json` - connector registration + runtime bridge state
- `connector-event-queue.json` - persistent connector event replay queue (override: `CTX_CONNECTOR_QUEUE_PATH`)
- `ops.log` - local CLI operations audit log (queue/auth/runtime actions; override: `CTX_CLI_OPS_LOG_PATH`)
- `backups/` - encrypted backup files (`.enc`) and optional plaintext dumps (`.json`)

## Testing and CI

- Unit/integration tests use Vitest:
  - `packages/core/test/*`
  - `packages/daemon/test/*`
- CI workflow:
  - active location: `.github/workflows/ci.yml`
  - Runs `npm ci`, `npm run typecheck`, `npm run build`, `npm run test`

## Repo Governance

- Keep a single git root for all `packages/*`.
- Do not keep nested git repositories inside packages.
- If nested git is detected (for example `packages/ui/.git`), migrate with:
  - `scripts/repo/adopt-ui-monorepo.ps1` (or npm scripts above)
- Governance references:
  - `docs/INDEX.md`
  - `docs/ENV_REFERENCE.md`
  - `docs/SEMANTIC_BLACKBOARD_ARCHITECTURE.md`
  - `docs/HYBRID_STORAGE_AND_SYNC_MODEL.md`
  - `docs/CONNECTOR_SERVICE_ARCHITECTURE.md`
  - `docs/RELEASE.md`
