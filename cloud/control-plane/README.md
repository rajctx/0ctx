# 0ctx Control Plane (Dev Reference)

This is a local reference control-plane server for connector/cloud development.

It implements:
- `POST /v1/connectors/register`
- `POST /v1/connectors/heartbeat`
- `GET /v1/connectors/capabilities`
- `POST /v1/connectors/events`
- `GET /v1/connectors/commands`
- `POST /v1/connectors/commands/ack`
- `POST /v1/connectors/commands/enqueue` (dev helper)
- `GET /v1/health`

## Run

```bash
node cloud/control-plane/server.js
```

Optional env vars:
- `HOST` (default `127.0.0.1`)
- `PORT` (default `8787`)
- `STREAM_BASE_URL` (default derived from host/port)

## CLI integration

Point connector cloud client to this server:

```bash
set CTX_CONTROL_PLANE_URL=http://127.0.0.1:8787/v1
0ctx connector register --require-cloud
0ctx connector run --once
```

Queue a command for a connector:

```bash
curl -X POST http://127.0.0.1:8787/v1/connectors/commands/enqueue ^
  -H "Authorization: Bearer dev-token" ^
  -H "Content-Type: application/json" ^
  -d "{\"machineId\":\"<machine-id>\",\"method\":\"setSyncPolicy\",\"contextId\":\"<context-id>\",\"params\":{\"contextId\":\"<context-id>\",\"syncPolicy\":\"metadata_only\"}}"
```
