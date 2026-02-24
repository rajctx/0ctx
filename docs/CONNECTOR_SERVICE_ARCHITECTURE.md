# Connector Service Architecture

Updated: 2026-02-24  
Owner: Runtime Platform

Related:
- `docs/SEMANTIC_BLACKBOARD_ARCHITECTURE.md`
- `docs/HYBRID_STORAGE_AND_SYNC_MODEL.md`
- `docs/INSTALL.md`

## 1) Purpose

The connector is an always-on local service that bridges:
- local daemon/socket runtime
- cloud control plane
- hosted UI expectations

It replaces the assumption that the UI runs on the same machine as daemon internals.

## 2) Responsibilities

1. Daemon lifecycle
- detect daemon health
- start/restart daemon when required
- expose connector + daemon status

2. Cloud session and transport
- register connector instance
- maintain authenticated outbound stream
- heartbeat and reconnect with backoff

3. Event and command bridge
- forward local mutation events to cloud
- receive cloud commands and apply locally
- acknowledge and replay safely

4. Policy enforcement
- cache effective tenant policy
- block disallowed operations locally
- enforce context sync modes

## 3) Service Lifecycle

Platforms:
- Windows Service
- macOS launchd
- Linux systemd user service

Lifecycle commands (target):
- install
- enable
- disable
- uninstall
- start
- stop
- restart
- status

Behavior guarantees:
- auto-start on reboot
- restart on crash
- bounded resource usage with telemetry

## 4) Connector State Machine

States:
- `booting`
- `registering`
- `connected`
- `degraded`
- `offline_queueing`
- `reauth_required`
- `stopped`

Transitions are driven by:
- auth token validity
- stream health
- daemon reachability
- queue pressure thresholds

## 5) Data Flow

Outbound:
1. daemon mutation event emitted.
2. connector validates policy.
3. connector persists queue entry.
4. connector sends to cloud stream/API.
5. on ack, queue item marked delivered.

Inbound:
1. cloud sends command/event.
2. connector validates tenant/session/policy.
3. connector invokes daemon IPC method.
4. connector emits result ack and audit event.

## 6) Security Model

- connector uses short-lived credentials from cloud auth flow.
- credentials stored in OS keyring-backed storage.
- stream channel uses TLS and server identity validation.
- every event carries source attribution and correlation id.

## 7) Observability

Required metrics:
- queue depth
- replay lag
- heartbeat latency
- reconnect count
- command success/error rates

Required logs:
- structured JSON logs with request/event ids
- no secret/token payloads

UI/CLI status output must show:
- connector state
- daemon state
- sync posture (connected/degraded/offline)
- last successful cloud round-trip

## 8) Failure Handling

1. Network partition
- switch to `offline_queueing`
- retain local functionality
- replay once connected

2. Auth expiry
- switch to `reauth_required`
- reject cloud-bound operations
- keep local-only operations working

3. Daemon crash
- restart daemon with bounded retry policy
- escalate to unhealthy after retry budget

4. Event replay collisions
- idempotency keys and duplicate suppression

## 9) Implementation Notes

- Keep connector as a separate runtime component to avoid overloading CLI command mode.
- Reuse existing daemon IPC protocol where possible.
- Add dedicated stream transport helper for persistent channels.
- Add integration tests for reboot, reconnect, replay, and auth rotation scenarios.
