# Environment Variable Reference

Complete reference for all environment variables used across the 0ctx stack.

---

## UI / Dashboard (`ui/`)

These are set in `ui/.env` (dev) or your deployment platform (production).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | **Yes** | — | Postgres connection string. Local dev: `postgres://ctx:ctx_dev_password@localhost:5432/ctx`. Throws on startup if missing. |
| `AUTH0_SECRET` | **Yes** | — | Session encryption key. Generate: `openssl rand -hex 32` |
| `AUTH0_ISSUER_BASE_URL` | **Yes** | — | Auth0 tenant URL, e.g. `https://your-tenant.us.auth0.com` |
| `AUTH0_CLIENT_ID` | **Yes** | — | Regular Web Application client ID (browser login) |
| `AUTH0_CLIENT_SECRET` | **Yes** | — | Regular Web Application client secret |
| `AUTH0_DEVICE_CLIENT_ID` | **Yes** | `AUTH0_CLIENT_ID` | Native Application client ID (CLI device code flow). Falls back to `AUTH0_CLIENT_ID` if not set. |
| `AUTH0_AUDIENCE` | **Yes** | `https://0ctx.com/api` | Auth0 API identifier. Must match exactly. |
| `APP_BASE_URL` | **Yes** | `http://localhost:3000` | App base URL for Auth0 callback/logout redirects |
| `AUTH0_DOMAIN` | No | — | Auth0 tenant domain (used by Auth0 SDK internally) |
| `AUTH0_ISSUER_BASE_URL` | **Yes** | — | Full issuer URL for device code proxy routes |
| `NEXT_PUBLIC_AUTH0_ISSUER_BASE_URL` | **Yes** | — | Client-side issuer URL (must start with `NEXT_PUBLIC_`) |
| `CTX_UI_BASE_URL` | No | `http://localhost:3000` | Base URL sent to CLI as the verification URI. Set to your production URL in prod. |
| `CTX_BFF_RATE_LIMIT_RPM` | No | `300` | Per-IP rate limit (requests per minute) for BFF API routes |
| `CTX_CONNECTOR_MACHINE_ID` | No | `$HOSTNAME` | Override machine ID used in BFF connector resolution |

---

## CLI (`packages/cli/`)

These are set in the user's shell environment or via `0ctx config set`.

### Auth & Identity

| Variable | Default | Description |
|----------|---------|-------------|
| `CTX_AUTH_TOKEN` | — | Inject a bearer token directly. Skips file/keyring lookup. Useful for CI pipelines. |
| `CTX_AUTH_TOKEN_FILE` | — | Path to a file containing a bearer token. Alternative to `CTX_AUTH_TOKEN`. |
| `CTX_AUTH_FILE` | `~/.0ctx/auth.json` | Override path to the auth token JSON file |
| `CTX_TENANT_ID` | — | Inject tenant ID directly. Used in CI when token doesn't embed tenant. |
| `CTX_AUTH_SERVER` | `https://www.0ctx.com` | Override the auth server URL (for self-hosted deployments) |
| `CTX_AUTH_TOKEN_ROTATION_WARN_DAYS` | `7` | Warn N days before access token expires |

### API & Connectivity

| Variable | Default | Description |
|----------|---------|-------------|
| `CTX_API_URL` | `https://0ctx.com/api/v1` | Override the BFF API base URL. Use for self-hosted or local dev. |
| `CTX_API_TIMEOUT_MS` | `10000` | HTTP request timeout in milliseconds |
| `CTX_CONTROL_PLANE_URL` | — | **Deprecated.** Use `CTX_API_URL` instead. Kept for backward compatibility. |
| `CTX_CONTROL_PLANE_TIMEOUT_MS` | — | **Deprecated.** Use `CTX_API_TIMEOUT_MS` instead. |

### Storage Paths

| Variable | Default | Description |
|----------|---------|-------------|
| `CTX_DB_PATH` | `~/.0ctx/0ctx.db` | Override path to the local SQLite graph database |
| `CTX_CONNECTOR_STATE_PATH` | `~/.0ctx/connector.json` | Override path to connector registration state file |
| `CTX_CONNECTOR_QUEUE_PATH` | `~/.0ctx/connector-event-queue.json` | Override path to the connector event queue file |
| `CTX_BACKUP_DIR` | `~/.0ctx/backups` | Override directory for local graph backups |
| `CTX_CLI_OPS_LOG_PATH` | `~/.0ctx/ops.log` | Override path to the CLI operations log |
| `CTX_HOOK_DUMP_DIR` | `~/.0ctx/hook-dumps` | Override directory for local raw hook payload dumps for all supported hook-integrated agents |
| `CTX_HOOK_DUMP_RETENTION_DAYS` | `30` | Default retention window used by `0ctx connector hook prune` when `--days` is not passed |

### Connector Queue Tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `CTX_CONNECTOR_QUEUE_MAX_ITEMS` | `1000` | Maximum number of events in the outbound connector queue |
| `CTX_CONNECTOR_QUEUE_MAX_AGE_HOURS` | `24` | Maximum age in hours before queued events are pruned |

### Internal / Dev

| Variable | Default | Description |
|----------|---------|-------------|
| `CTX_SHELL_MODE` | — | Set to `1` to force interactive shell mode |

---

## Core (`packages/core/`)

These apply to the local graph engine — used by CLI, daemon, and MCP.

| Variable | Default | Description |
|----------|---------|-------------|
| `CTX_MASTER_KEY` | File: `~/.0ctx/master.key` | 32-byte hex encryption master key. If not set, loaded from the key file. Generated on first run. |
| `CTX_AUDIT_HMAC_SECRET` | Auto-generated per machine | HMAC-SHA256 secret for audit log chain integrity. Auto-generated on first use and persisted to `~/.0ctx/config.json`. Override in enterprise environments to use a shared secret for cross-machine audit verification. |
| `CTX_DB_PATH` | `~/.0ctx/0ctx.db` | Override SQLite database path |
| `CTX_LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `CTX_LOG_FORMAT` | `json` | Log format: `json` or `text` |

### Core Config Keys (`~/.0ctx/config.json`)

These can be set via `0ctx config set <key> <value>` or env var override:

| Key | Env Override | Default | Description |
|-----|-------------|---------|-------------|
| `auth.server` | `CTX_AUTH_SERVER` | `https://www.0ctx.com` | Auth server base URL |
| `sync.enabled` | `CTX_SYNC_ENABLED` | `true` | Enable/disable cloud sync |
| `sync.endpoint` | `CTX_SYNC_ENDPOINT` | `https://0ctx.com/api/v1/sync` | Sync endpoint URL |
| `ui.url` | — | `https://0ctx.com` | Dashboard URL opened by `0ctx dashboard` |
| `audit.hmacSecret` | `CTX_AUDIT_HMAC_SECRET` | Auto-generated | Per-machine audit HMAC secret |
| `integration.chatgpt.enabled` | `CTX_INTEGRATION_CHATGPT_ENABLED` | `false` | Enable ChatGPT integration |
| `integration.chatgpt.requireApproval` | `CTX_INTEGRATION_CHATGPT_REQUIRE_APPROVAL` | `true` | Require approval for ChatGPT operations |
| `integration.autoBootstrap` | `CTX_INTEGRATION_AUTO_BOOTSTRAP` | `true` | Auto-bootstrap MCP on setup |

---

## Daemon (`packages/daemon/`)

| Variable | Default | Description |
|----------|---------|-------------|
| `CTX_AUTH_TOKEN` | — | Inject bearer token for daemon-to-cloud calls (CI/unattended) |
| `CTX_TENANT_ID` | — | Inject tenant ID for daemon-to-cloud calls |
| `CTX_USER_ID` | `env:CTX_AUTH_TOKEN` | Override user ID for sync attribution |
| `CTX_BACKUP_DIR` | `~/.0ctx/backups` | Override backup directory |

---

## Update Server (`cloud/update-server/`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8888` | HTTP port to listen on |
| `HOST` | `127.0.0.1` | Host to bind to |
| `RELEASES_DIR` | `./releases` | Local directory for release manifests (dev mode) |
| `S3_RELEASES_URL` | — | S3-compatible base URL for release manifests (production) |

---

## MCP Server (`packages/mcp/`)

| Variable | Default | Description |
|----------|---------|-------------|
| `APPDATA` | Platform default | Windows AppData path override for MCP bootstrap |

---

## Deprecated Variables

These are still read for backward compatibility but should not be used in new setups:

| Deprecated | Use Instead |
|-----------|-------------|
| `CTX_CONTROL_PLANE_URL` | `CTX_API_URL` |
| `CTX_CONTROL_PLANE_TIMEOUT_MS` | `CTX_API_TIMEOUT_MS` |
