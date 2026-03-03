# Semantic Blackboard Architecture

Updated: 2026-02-24  
Owner: Platform Architecture

Related:
- `docs/HYBRID_STORAGE_AND_SYNC_MODEL.md`
- `docs/CONNECTOR_SERVICE_ARCHITECTURE.md`
- `docs/INDEX.md`

## 1) Goal

Replace rigid agent-to-agent routing with an event-driven blackboard runtime where agents collaborate through 0ctx state.

The runtime is hybrid:
- local daemon remains the low-latency execution engine.
- cloud control plane provides multi-user coordination, tenancy, policy, and hosted UI.

## 2) Core Principles

- Agents communicate through blackboard state, not direct peer chains.
- All orchestration is policy-gated.
- Completion is deterministic, not "silence means done".
- Local-first behavior remains intact under connectivity loss.

## 3) Runtime Topology

1. **Local Daemon**
- Owns local SQLite graph state and local MCP operations.
- Emits mutation events and consumes command events.

2. **Local Connector Service**
- Runs as always-on OS service.
- Streams events to cloud and applies cloud commands locally.
- Handles reconnect, replay, backoff, and policy cache.

3. **Cloud Control Plane**
- Maintains tenant-scoped blackboard index and task lease state.
- Evaluates policies and completion gates.
- Serves hosted UI APIs and observability.

## 4) Blackboard Event Model

Event classes:
- `NodeAdded`
- `NodeUpdated`
- `EdgeAdded`
- `TaskClaimed`
- `TaskReleased`
- `GateRaised`
- `GateCleared`
- `TaskCompleted`

Event envelope:

```json
{
  "eventId": "evt_...",
  "contextId": "ctx_...",
  "type": "NodeAdded",
  "source": "daemon|connector|cloud|agent:<id>",
  "sequence": 1287,
  "timestamp": "2026-02-24T08:30:00.000Z",
  "payload": {}
}
```

Rules:
- `eventId` must be globally unique and idempotent.
- `sequence` is monotonic per `contextId` on each producer.
- consumers must treat duplicate events as no-op.

## 5) Agent Contract

Agents are specialized workers subscribed by filter:
- context scope
- node types
- tags
- gate severity
- state transitions

Agents can:
- claim tasks (`claimTask`)
- write artifacts/decisions/constraints
- raise gates (`GateRaised`)
- clear gates (`GateCleared`)

Agents cannot bypass:
- tenant policy
- data mode restrictions (`local_only`, `metadata_only`, `full_sync`) enforced by daemon policy APIs (`getSyncPolicy`, `setSyncPolicy`) and operator controls (`0ctx sync policy get/set`, MCP `ctx_sync_policy_get/set`)
- required quality gate checks

## 6) Completion Semantics

Completion policy: **Policy-Gated Stabilization**

A task is complete only when all conditions are true:
1. no blocking gates are open.
2. required quality gates pass (policy profile).
3. no new blocking event appears during stabilization cooldown window.
4. task lease is cleanly released or transferred.

Default required gates:
- typecheck
- test
- lint
- security policy checks

## 7) API Additions (Planned)

Local daemon IPC:
- `subscribeEvents`
- `unsubscribeEvents`
- `listSubscriptions`
- `ackEvent`
- `getBlackboardState`
- `claimTask`
- `releaseTask`
- `resolveGate`

Cloud control plane:
- `POST /v1/connectors/register`
- `POST /v1/connectors/heartbeat`
- `WS /v1/connectors/stream`
- `POST /v1/contexts/:id/sync`
- `GET /v1/capabilities`

## 8) Failure Modes and Safeguards

1. Event storm:
- per-context rate limits
- lease contention backoff
- dead-letter stream

2. Connector offline:
- local queue persists
- replay on reconnect
- hosted UI shows degraded state

3. Duplicate/out-of-order events:
- idempotency keys
- sequence checks and replay window controls

4. Bad agent behavior:
- policy guardrails
- signed source attribution
- reversible gate operations through audit trail

## 9) Rollout Strategy

1. Add event primitives to daemon/core behind feature flag.
2. Introduce connector streaming and replay.
3. Enable cloud gate evaluator and tenant policies.
4. Turn on blackboard execution for selected contexts.
5. Expand to default mode after SLO validation.

## 10) Exit Criteria

- event subscriptions stable under reconnect/replay scenarios.
- completion evaluator produces deterministic outcomes.
- no regression to local-only MCP/daemon operations.
- hosted UI can observe and control blackboard state per tenant.
