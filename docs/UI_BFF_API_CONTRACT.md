# UI BFF API Contract

Updated: 2026-02-24  
Owner: UI Platform + Cloud Platform

## Purpose

Define canonical hosted UI API contracts for `/api/v1/*`.

The hosted UI must call BFF routes only. The BFF calls control-plane APIs and connector bridges; it must not open local daemon sockets directly.

## Shared Types

```ts
type RuntimePosture = 'connected' | 'degraded' | 'offline';
type SyncPolicy = 'local_only' | 'metadata_only' | 'full_sync';
type OnboardingStepStatus = 'todo' | 'in_progress' | 'blocked' | 'done';
```

## Error Envelope

```json
{
  "error": {
    "code": "string_code",
    "message": "Human-readable message",
    "retryable": true,
    "correlationId": "req_..."
  }
}
```

## Endpoints

## `GET /api/v1/runtime/status`

Returns:
- connector posture
- bridge health
- cloud connectivity
- capability summary

Success shape (example):

```json
{
  "posture": "connected",
  "bridgeHealthy": true,
  "cloudConnected": true,
  "capabilities": ["sync", "blackboard", "commands"]
}
```

## `POST /api/v1/runtime/doctor`

Triggers diagnostic workflow and returns structured checks.

## `POST /api/v1/runtime/repair`

Triggers runtime repair workflow and returns operation summary.

## `POST /api/v1/integrations/bootstrap`

Request body:

```json
{
  "clients": ["claude", "cursor", "windsurf"],
  "dryRun": true
}
```

Response:
- per-client status list
- config path and message details

## `POST /api/v1/connector/register`

Registers connector machine identity with cloud control plane.

## `POST /api/v1/connector/queue/drain`

Drains connector replay queue.
Response must include:
- `sent`
- `failed`
- `batches`
- `wait.reason`

## `GET /api/v1/contexts/:contextId/sync-policy`

Returns current context sync policy.

## `PUT /api/v1/contexts/:contextId/sync-policy`

Request body:

```json
{
  "syncPolicy": "metadata_only"
}
```

## `GET /api/v1/audit`

Returns scoped audit events for active context or tenant.

## `GET /api/v1/backups`

Returns backup catalog.

## `POST /api/v1/backups`

Creates backup according to requested parameters.

## Security and Auth Requirements

- All mutating endpoints require authenticated session.
- Tenant scope must be verified server-side.
- CSRF protection required for mutating endpoints.
- Rate limiting required for connector and operational control routes.
