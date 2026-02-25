# Environment Variables (Canonical)

Updated: 2026-02-24

This document is the canonical env-var contract for hosted UI + connector/cloud integrations.

## Hosted UI / BFF

| Variable | Required | Purpose |
|---|---|---|
| `AUTH0_SECRET` | Yes | Session cookie encryption secret for Auth0 SDK. |
| `AUTH0_BASE_URL` | Yes | Public base URL for hosted UI. |
| `AUTH0_ISSUER_BASE_URL` | Yes | Auth0 tenant issuer URL. |
| `AUTH0_CLIENT_ID` | Yes | Auth0 application client id. |
| `AUTH0_CLIENT_SECRET` | Yes | Auth0 application client secret. |
| `CTX_CONTROL_PLANE_URL` | Yes | Base URL for cloud control-plane APIs used by BFF. |
| `CTX_UI_BASE_URL` | Yes | Canonical hosted UI URL (handoff/links). |
| `DATABASE_URL` | Yes | PostgreSQL connection string for Prisma ORM (e.g. `postgresql://user:pass@host:5432/db`). |
| `NODE_ENV` | Yes | Runtime mode (`production`, `development`, `test`). |

## Optional (Recommended)

| Variable | Required | Purpose |
|---|---|---|
| `SENTRY_DSN` | No | Error and performance telemetry. |
| `CTX_BFF_TIMEOUT_MS` | No | Outbound API timeout for BFF requests. |
| `CTX_BFF_RATE_LIMIT_PER_MIN` | No | Server-side rate limit per session or token scope. |
| `CTX_BFF_LOG_LEVEL` | No | BFF logging verbosity. |

## Local Runtime / CLI

| Variable | Required | Purpose |
|---|---|---|
| `CTX_DB_PATH` | No | Override local SQLite DB path. |
| `CTX_SOCKET_PATH` | No | Override local daemon socket/pipe path. |
| `CTX_MASTER_KEY` | No | Encryption key for backup payload protection. |
| `CTX_CONTROL_PLANE_URL` | No | Override connector cloud control-plane endpoint. |
| `CTX_CONTROL_PLANE_TIMEOUT_MS` | No | Connector cloud timeout in milliseconds. |
| `CTX_CONNECTOR_STATE_PATH` | No | Override connector registration state file path. |
| `CTX_CONNECTOR_QUEUE_PATH` | No | Override connector event queue file path. |
| `CTX_CLI_OPS_LOG_PATH` | No | Override CLI operations log path. |

## Policy

- Do not commit secrets to repo.
- Production secrets must be managed through platform secret storage.
- Any new runtime env var must be added to this document and referenced from deploy docs.
