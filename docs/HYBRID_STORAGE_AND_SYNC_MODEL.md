# Hybrid Storage and Sync Model

Updated: 2026-02-24  
Owner: Platform + Security

Related:
- `docs/SEMANTIC_BLACKBOARD_ARCHITECTURE.md`
- `docs/CONNECTOR_SERVICE_ARCHITECTURE.md`
- `docs/ENTERPRISE_ROADMAP_AND_TRACKER.md`

## 1) Decision

0ctx uses a split storage model:
- **Local runtime**: SQLite (source of truth for local/offline operation).
- **Cloud runtime**: Postgres + event bus + object storage for multi-tenant coordination and hosted UX.

Cloud SQLite is not a primary datastore strategy.

## 2) Sync Policy Modes (Per Context)

1. `local_only`
- context data stays on machine.
- cloud receives connector health and minimal operational metadata only.

2. `metadata_only`
- cloud stores context index metadata, audit pointers, and operational signals.
- full node/edge payloads are excluded or redacted.

3. `full_sync`
- cloud stores full graph state for collaboration and centralized operations.

Operational controls:
- CLI: `0ctx sync policy get --context-id=<id>` and `0ctx sync policy set <local_only|metadata_only|full_sync> --context-id=<id>`.
- Daemon IPC: `getSyncPolicy`, `setSyncPolicy`.
- MCP tools: `ctx_sync_policy_get`, `ctx_sync_policy_set`.

## 3) Storage Contract

| Entity | Local SQLite | Cloud Postgres | Event Bus | Object Storage | Notes |
|---|---|---|---|---|---|
| Context metadata | Yes | Yes | No | No | Cloud copy follows sync policy |
| Nodes / edges | Yes | Full payload only in `full_sync` | Mutation events | No | Local is authoritative while offline |
| Checkpoints | Yes | Catalog + state | Lifecycle events | Optional payloads | Keep large payloads out of Postgres |
| Audit logs | Yes | Tenant audit index | Audit events | Optional exports | Immutable append behavior required |
| Backups | Local refs | Backup catalog | Backup events | Encrypted blobs | Envelope encryption required |
| Policies / RBAC | Cached effective set | Source of truth | Policy update events | No | Connector enforces locally |
| Sessions / connectors | Ephemeral local | Durable records | Heartbeat/disconnect | No | Required for hosted operations |
| Task leases / gates | Local cache | Durable lease/gate state | Lease/gate events | No | Blackboard completion depends on this |
| Metrics / health | Local snapshots | Aggregated records | Telemetry events | No | Rollups for UI consumption |
| Embeddings / search | Optional | Optional | Reindex events | Optional | Phase-gated, not day-1 required |

## 4) Consistency Model

Write path:
1. local daemon commits mutation in SQLite.
2. connector emits signed mutation event with idempotency key.
3. cloud upserts event and updates materialized state when allowed by policy.

Read path:
- local MCP/CLI read local SQLite directly.
- hosted UI reads cloud projections.
- operations page exposes divergence indicators until convergence.

## 5) Conflict Handling

Expected conflict classes:
- concurrent edits across connectors.
- lease contention.
- replay duplicates.

Resolution policy:
- idempotent upsert by mutation id.
- lease ownership with TTL and explicit transfer.
- deterministic merge for compatible graph updates.
- unresolved collisions raise `open_question`/gate for human review.

## 6) Security and Data Governance

1. Encryption
- TLS for all connector-cloud traffic.
- cloud at-rest encryption via KMS.
- local encryption key model remains supported.

2. Tenant isolation
- row-level tenant partitioning and scoped credentials.
- per-context sync policy enforcement.

3. Retention and export
- policy-driven retention windows by tenant and sync mode.
- auditable export/delete workflows.

4. Secret handling
- connector credentials short-lived and rotatable.
- no plaintext secrets in logs/events.

## 7) Operational Scenarios

1. Offline machine
- local writes continue.
- queue accumulates and replays after reconnect.

2. Cloud outage
- local workflows unaffected.
- UI/ops surfaces degraded posture and lag metrics.

3. Regulated tenant
- default to `local_only` or `metadata_only`.
- explicit admin action required for `full_sync`.

4. High-throughput swarm
- event bus backpressure and dead-letter handling enabled.

## 8) Default Policy Baseline

Default recommendations:
- new contexts: `metadata_only`.
- production collaboration contexts: `full_sync` with policy approval.
- sensitive contexts: `local_only`.

Tenant admins can override defaults per workspace/context.
