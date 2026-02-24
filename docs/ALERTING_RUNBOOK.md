# Alerting Runbook

Operational alert definitions, thresholds, and escalation procedures for 0ctx.

## Health Check Endpoints

| Service | Endpoint | Expected |
|---------|----------|----------|
| Control-Plane | `GET /v1/health` | `{ "status": "ok" }` |
| BFF | `GET /api/v1/health` | `{ "status": "ok" }` |
| Metrics (BFF) | `GET /api/v1/metrics` | Prometheus text |
| Metrics (CP) | `GET /v1/metrics` | Prometheus text |

## Alert Definitions

### CRITICAL: Service Unreachable
- **Condition**: Health endpoint returns non-200 or times out (>5s) for 3 consecutive checks.
- **Impact**: Users cannot access the platform.
- **Action**: Check process status, restart service, check logs for crash reason.

### WARNING: High Memory Usage
- **Condition**: `memoryMb.heapUsed` > 80% of `memoryMb.heapTotal` in `/v1/health`.
- **Impact**: Potential OOM crash if unaddressed.
- **Action**: Check for memory leaks, restart service if needed.

### WARNING: Command Queue Backlog
- **Condition**: `queuedCommands` > 100 in `/v1/health`.
- **Impact**: Connector commands delayed.
- **Action**: Check connector connectivity and heartbeat status.

### WARNING: Control-Plane Latency
- **Condition**: `controlPlane.latencyMs` > 2000 in BFF `/api/v1/health`.
- **Impact**: Slow UI responses.
- **Action**: Check control-plane load, network conditions.

## Webhook Alert Contract

Health check scripts can POST alerts to a webhook URL set via `CTX_ALERT_WEBHOOK_URL`.

```json
{
  "severity": "critical | warning | info",
  "service": "control-plane | bff | connector",
  "alert": "service_unreachable",
  "message": "Control-plane health check failed (timeout after 5000ms)",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "details": {}
}
```

## Monitoring Script

Use `scripts/ops/check-health.ps1` to poll health endpoints:

```powershell
.\scripts\ops\check-health.ps1 -BffUrl http://localhost:3000 -CpUrl http://localhost:8787
```

The script exits with code 1 if any critical check fails, making it suitable for CI and cron jobs.

## Escalation

1. Automated alert fires → check runbook entry above.
2. If issue persists > 15 min → page on-call.
3. If data loss suspected → follow `docs/DISASTER_RECOVERY.md`.
