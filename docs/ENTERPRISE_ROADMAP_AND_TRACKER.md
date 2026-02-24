# 0ctx Enterprise Productization Roadmap + Tracker

Last updated: 2026-02-24  
Document owner: Platform + Product

Status legend:
- `Planned`
- `In Progress`
- `Blocked`
- `Done`
- `Superseded`

## 1) Locked Decisions

- Product model: hosted cloud control plane + always-on local connector service.
- Distribution path: npm registry (`@0ctx` scope), no repo clone required for end users.
- Auth model: device code login + API tokens.
- Storage model: local SQLite + cloud Postgres/event bus/object storage.
- Sync policy model: per-context policy (`local_only`, `metadata_only`, `full_sync`) with full encrypted sync support.
- Orchestration model: hybrid semantic blackboard with policy-gated stabilization.
- Runtime behavior: connector/daemon run as managed OS service with auto-start after reboot on Windows, macOS, and Linux.

## 2) Target User Experience (No Clone)

1. User installs CLI:
   - `npm install -g @0ctx/cli`
2. User runs guided setup:
   - `0ctx setup --clients=all`
3. CLI setup performs:
   - auth check/login
   - managed service startup (connector/daemon runtime)
   - MCP bootstrap + runtime verification
4. User opens UI and completes setup wizard:
   - hosted UI (`https://app.0ctx.com`) with connector bridge
   - install check
   - auth status
   - tenant connectivity
   - connector + daemon health
   - MCP registration state
5. After system reboot:
   - connector auto-starts and ensures daemon availability
   - CLI and UI show healthy state without manual restart commands

## 3) Architecture Plan

## 3.1 Packaging and Distribution

- Publish all runtime packages with compiled artifacts:
  - `@0ctx/core`
  - `@0ctx/daemon`
  - `@0ctx/mcp`
  - `@0ctx/cli`
- Replace local `file:` dependency expectations in release path with publishable version graph.
- Ensure publish order is enforced.
- Ensure CLI install path works with no local source tree assumptions.

Primary update areas:
- `packages/*/package.json`
- root `package.json` scripts
- release docs and changelog

## 3.2 Daemon Service Lifecycle (All OS)

- Add service management commands in CLI:
  - `0ctx daemon service install`
  - `0ctx daemon service enable`
  - `0ctx daemon service disable`
  - `0ctx daemon service uninstall`
  - `0ctx daemon service status`
  - `0ctx daemon service restart`
- OS-specific integration:
  - Windows Service
  - `launchd` (macOS)
  - `systemd` (Linux)
- Requirements:
  - boot auto-start
  - restart on failure
  - deterministic health checks
  - idempotent install/uninstall

## 3.3 Managed Cloud + Hybrid Local/Cloud Connectivity

- Control-plane concerns:
  - org/workspace identity
  - policy state
  - device registration
- multi-tenant endpoint binding
- encrypted data channels
- connector fleet registration and health
- Local daemon remains system of record for online/offline operations; cloud sync is asynchronous with policy controls.

## 3.4 Authentication and Session Model

- Device code flow from CLI and UI.
- Secure token storage in OS credential store.
- Refresh-token lifecycle with explicit logout revocation.
- Tenant URL + org binding captured in local session metadata.

## 3.5 Encrypted Sync Model

- Sync uses encrypted payload envelopes.
- Retries with queue + backoff.
- Non-blocking local writes when cloud unavailable.
- Explicit sync status surfaced in CLI and UI.
- Per-context sync policies:
  - `local_only`
  - `metadata_only`
  - `full_sync`

## 3.6 MCP Runtime Behavior

- MCP remains local and functional when cloud connectivity is degraded.
- Add health/capability indicators for:
  - local-only mode
  - connected mode
  - degraded mode
- Cloud failures must not break local CRUD or context retrieval.

## 3.7 Semantic Blackboard Runtime

- Event-driven collaboration model where specialized agents react to blackboard changes.
- Core event classes:
  - `NodeAdded`, `NodeUpdated`, `EdgeAdded`
  - `TaskClaimed`, `TaskReleased`
  - `GateRaised`, `GateCleared`, `TaskCompleted`
- Completion policy:
  - no blocking gates
  - mandatory quality checks pass
  - stabilization window expires with no new blockers

## 3.8 Hosted UI + Connector Model

- Hosted UI is the primary enterprise surface.
- Local connector bridges hosted API/runtime actions to local daemon and MCP operations.
- All hosted actions are capability-gated by connector and tenant policy status.

## 4) Current Gaps Snapshot

- Event pub/sub and subscription runtime is not implemented in daemon/MCP.
- Connector stream gateway and command/event bridge are not implemented.
- Hosted UI architecture is not yet wired to cloud capability APIs.
- Sync policy modes (`local_only`, `metadata_only`, `full_sync`) are partially implemented locally (core/daemon/MCP/CLI); connector-cloud policy reconciliation and hosted policy control APIs remain pending.
- Tenant-level blackboard policy gates and completion evaluator are not yet implemented.

## 5) Milestones

## Phase A: Installability Foundation

Scope:
- Publishable package graph and install scripts.

Deliverables:
- npm publish path working for all runtime packages.
- CLI install path validated on clean machine.

Exit criteria:
- End user can install and run `0ctx` without cloning repo.

## Phase B: Service Lifecycle

Scope:
- Background daemon management across all 3 OS.

Deliverables:
- Service install/enable/status/restart commands.
- OS unit definitions and scripts.

Exit criteria:
- Daemon survives reboot and recovers from process failure.

## Phase C: Auth + Tenant Connectivity

Scope:
- Device login, token storage, tenant link.

Deliverables:
- CLI auth flow and UI auth flow.
- Tenant status surfaced in daemon/CLI/UI.

Exit criteria:
- User can connect local runtime to tenant with persistent auth.

## Phase D: Encrypted Sync

Scope:
- Secure data sync for graph/checkpoint state.

Deliverables:
- Encrypted sync queue and retry logic.
- Connection and sync telemetry surfaces.

Exit criteria:
- Reliable encrypted sync in online/degraded/recovery scenarios.

## Phase E: UX and Docs Completion

Scope:
- End-to-end onboarding clarity and trust.

Deliverables:
- Setup wizard and settings routes.
- Placeholder UI actions removed or wired.
- Docs aligned to actual user journey.

Exit criteria:
- First-time user can complete setup in one guided flow.

## Phase F: Visualization + Hosted DevX Realignment

Scope:
- Graph UX improvements and distribution/channel experience upgrades.

Deliverables:
- Enterprise graph visualization/layout improvements.
- Hosted-UI-only distribution path alignment.
- `0ctx setup` onboarding wizard as canonical first-run command.
- Desktop runtime exploration.

Exit criteria:
- Graph usability and hosted onboarding DX are production-ready for enterprise pilot users.

## Phase G: Semantic Blackboard Runtime

Scope:
- Evented core/daemon runtime with subscriptions and gate-aware task flow.

Deliverables:
- Daemon IPC subscription methods.
- Blackboard event envelope and processing contracts.
- Policy-gated completion evaluator.

Exit criteria:
- Deterministic completion behavior under retries/reconnect.

## Phase H: Connector Service

Scope:
- Always-on connector service across Windows/macOS/Linux.

Deliverables:
- Register/heartbeat/stream connector lifecycle.
- Replay-safe queueing and policy cache.
- Unified connector status in CLI/UI.

Exit criteria:
- Connector survives reboot and network partitions with successful replay.

## Phase I: Cloud Control Plane + Sync Modes

Scope:
- Cloud APIs for connector orchestration and sync policy enforcement.

Deliverables:
- Connector stream gateway.
- Policy APIs and capability APIs.
- End-to-end sync mode enforcement by context.

Exit criteria:
- Hosted UI can operate contexts with explicit sync mode guarantees.

## Phase J: Hosted UI and AI Integrations

Scope:
- Production hosted UI and enterprise integration controls.

Deliverables:
- Hosted route architecture and capability-gated nav/actions.
- Connector-aware operations/audit UX.
- AI integration manager including ChatGPT-path support policy controls.

Exit criteria:
- No dead-end actions; complete enterprise flow from install to managed runtime.

## Phase K: Security + Operations Hardening

Scope:
- Hybrid runtime security posture and operational reliability.

Deliverables:
- Tenant security controls and key lifecycle.
- SLO dashboards, alerts, and incident runbooks.

Exit criteria:
- Canary rollout with enforced SLO targets and audited security controls.

## 6) Implementation Backlog (Decision-Complete)

| ID | Area | Description | Files to Update | Acceptance Criteria | Dependencies | Status | Owner | Milestone |
|---|---|---|---|---|---|---|---|---|
| PKG-01 | Packaging | Make package dependency graph publishable and no-clone compatible | `packages/*/package.json` | Published installs no longer require local workspace paths | None | Done | Platform | Phase A |
| PKG-02 | Release | Add publish orchestration for npm in deterministic order | root `package.json`, `docs/RELEASE.md`, release scripts | Single command path can validate and publish packages | PKG-01 | Done | Platform | Phase A |
| PKG-03 | Docs | Align INSTALL/QUICKSTART with real packaged install path | `docs/INSTALL.md`, `docs/QUICKSTART.md` | Docs match actual end-user install behavior | PKG-01, PKG-02 | Done | Product Docs | Phase A |
| SVC-01 | CLI/Daemon | Add Windows service lifecycle commands and health checks | `packages/cli/src/index.ts`, service scripts | Daemon auto-starts and is manageable after reboot on Windows | PKG-01 | Done | Platform | Phase B |
| SVC-02 | CLI/Daemon | Add macOS launchd lifecycle commands | CLI + `scripts/service/macos/*` | Daemon auto-starts and is manageable after reboot on macOS | PKG-01 | Done | Platform | Phase B |
| SVC-03 | CLI/Daemon | Add Linux systemd lifecycle commands | CLI + `scripts/service/linux/*` | Daemon auto-starts and is manageable after reboot on Linux | PKG-01 | Done | Platform | Phase B |
| AUTH-01 | CLI | Device code login/logout and token refresh support | `packages/cli/src/index.ts` + auth module | `0ctx auth login/logout/status` works reliably | PKG-01 | Done | Platform | Phase C |
| AUTH-02 | Daemon | Secure session/token persistence and tenant binding | `packages/daemon/src/*` | Daemon reports tenant/auth state with secure token handling | AUTH-01 | Done | Platform | Phase C |
| AUTH-03 | UI | Auth/setup/connect flows in UI | `packages/ui/src/app/*`, `packages/ui/src/components/*` | User can complete auth and tenant binding from UI | AUTH-01, AUTH-02 | Done | UI | Phase C |
| SEC-01 | CLI | `CTX_AUTH_TOKEN` env var bypass for CI/CD + headless auth | `packages/cli/src/auth.ts`, daemon auth reader | `0ctx` commands authenticate in CI without interactive device flow | AUTH-01 | Done | Platform | Phase C.1 |
| SEC-02 | CLI | OS keyring/credential storage (macOS Keychain, Windows Credential Manager, Linux secret-service) with `--insecure-storage` fallback | `packages/cli/src/auth.ts` + `packages/cli/src/keyring.ts` | Tokens stored in OS credential manager by default; plaintext only with explicit opt-in | AUTH-01 | Done | Platform | Phase C.1 |
| SEC-03 | CLI | Auto-open browser for verification URL + `--no-browser` flag | `packages/cli/src/auth.ts` | Login flow opens browser automatically (like gh/az/gcloud) | AUTH-01 | Done | Platform | Phase C.1 |
| SEC-04 | CLI | RFC 9700 compliance fixes: scope param, token_type validation, refresh rotation warning | `packages/cli/src/auth.ts` | Auth flow meets RFC 9700 BCP (Jan 2025) requirements | AUTH-01 | Done | Platform | Phase C.1 |
| SEC-05 | UI | Dashboard session auth gate via Auth0 (`@auth0/nextjs-auth0`) — PKCE browser flow, protected routes, session middleware. CLI/daemon auth stays custom (gh/gcloud pattern). | `packages/ui/src/proxy.ts`, `packages/ui/src/lib/auth0.ts`, `packages/ui/src/app/login/page.tsx` | Dashboard routes require Auth0 session; unauthenticated users redirected to Auth0 login; server actions reject unauthenticated calls | AUTH-01 | Done | UI | Phase C.1 |
| SYNC-01 | Daemon | Encrypted sync envelope, queue, retry/backoff | `packages/daemon/src/sync-engine.ts`, `packages/daemon/src/sync-queue.ts`, `packages/daemon/src/sync-transport.ts` | Sync succeeds with encryption and retry semantics | AUTH-02 | Done | Platform | Phase D |
| SYNC-02 | UI/CLI | Sync status and manual sync controls + global config system (`~/.0ctx/config.json`) | `packages/core/src/config.ts`, CLI `config`/`sync` commands, daemon health | User can inspect sync health, configure endpoints, and manage sync settings | SYNC-01 | Done | Platform + UI | Phase D |
| MCP-01 | MCP | Runtime capability/status exposure: `ctx_runtime_status` tool (connected/degraded/offline posture), `sync` feature in capabilities | `packages/mcp/src/tools.ts`, `packages/mcp/src/index.ts`, `packages/daemon/src/handlers.ts` | MCP clients can query runtime connection posture | AUTH-02, SYNC-01 | Done | Platform | Phase D |
| UI-01 | UI | Remove or wire non-functional sidebar/support/extension actions | `packages/ui/src/components/dashboard/dashboard-shell.tsx` | No dead-end primary UI actions remain | None | Done | UI | Phase E |
| UI-02 | UI | Wire landing page secondary CTAs to real destinations | `packages/ui/src/app/page.tsx` | All visible CTAs have meaningful navigation | None | Done | UI | Phase E |
| UI-03 | UI Docs | Expand UI flow documentation to include session auth, sync observability, and route-by-route human flows | `docs/UI_INFORMATION_ARCHITECTURE.md`, `docs/UI_USER_FLOWS.md` | Docs map route-by-route user journey and controls | UI-01, UI-02 | Done | Product Docs | Phase E |
| VIZ-01 | UI | Migrate graph renderer from `react-force-graph-2d` (Canvas) to `reagraph` (WebGL) for better performance, clustering, and 2D/3D support | `packages/ui/src/app/dashboard/ForceGraph.tsx`, `workspace-view.tsx` | Graph renders via WebGL; handles 1K+ nodes without degradation; clustering support available | None | Planned | UI | Phase F |
| VIZ-02 | UI | Add layout-switching toggle in workspace toolbar: Force / Hierarchical / Clustered views | `packages/ui/src/app/dashboard/ForceGraph.tsx`, `workspace-view.tsx` | Users can switch between force-directed, dagre/hierarchical, and clustered-by-type layouts | VIZ-01 | Planned | UI | Phase F |
| DX-01 | Platform | Legacy embedded-local-UI CLI path | `packages/cli/*`, `packages/ui/*` | Historical track recorded; replaced by hosted-UI-only runtime policy | None | Superseded | Core | Phase F |
| DX-02 | Platform | Desktop App: Bundle everything into a standalone local desktop application (Tauri/Electron) | `desktop-app/*` | Users download an installer and get a system tray app connected to hosted UI + local runtime | DX-03 | Planned | Core | Phase F |
| DX-03 | Platform | Hosted-UI-only CLI packaging model (`@0ctx/cli` does not package local UI runtime) | `packages/cli/*`, release scripts, docs | End-user install requires only CLI + hosted UI URL handoff; no embedded local Next.js runtime | None | Planned | Core | Phase F |
| DX-04 | Platform | Canonical first-run `0ctx setup` workflow (auth + runtime + MCP + hosted UI handoff) | `packages/cli/src/index.ts`, install/quickstart/readme docs | New users onboard from one command with verification and hosted dashboard open | DX-03 | Planned | Core | Phase F |
| ARCH-001 | Core/Daemon | Implement semantic blackboard events, subscription primitives, and gate-aware completion evaluator | `packages/core/src/graph.ts`, `packages/daemon/src/server.ts`, `packages/daemon/src/handlers.ts`, `packages/daemon/src/protocol.ts` | Event subscriptions and policy-gated completion work with deterministic behavior and audit trail | SYNC-02, MCP-01 | In Progress | Platform | Phase G |
| CONN-001 | Connector | Build always-on local connector service with register/heartbeat/stream bridge and replay queue | `packages/connector/*` (or `packages/cli/src/connector/*`), service scripts | Connector auto-starts, reconnects, and replays safely after offline periods | ARCH-001 | In Progress | Platform | Phase H |
| CLOUD-001 | Cloud | Implement control-plane APIs for connector management, capabilities, and stream gateway | `cloud/*` (new), API contracts docs | Hosted APIs support connector registration, stream commands, capability queries, and tenant scoping | CONN-001 | In Progress | Platform + Cloud | Phase I |
| SYNC-001 | Sync | Add per-context sync policy enforcement (`local_only`, `metadata_only`, `full_sync`) end-to-end | daemon sync modules + connector + cloud APIs | Context data movement always matches configured policy with auditability | CLOUD-001 | In Progress | Platform + Cloud | Phase I |
| UI-ENT-002 | UI | Build hosted enterprise UI architecture with capability-gated IA and connector-aware operations views | `packages/ui/src/app/*`, `packages/ui/src/components/*` | Hosted UI routes are fully functional, policy-aware, and free of dead-end actions | CLOUD-001, CONN-001 | Planned | UI | Phase J |
| UI-OPS-001 | UI | Implement hosted operations surfaces for connector health, queue lag, diagnostics, and reliability controls | `packages/ui/src/app/operations/*`, operations components, cloud capabilities client | Operations route provides actionable runbook flows and live runtime posture without local shell dependency | UI-ENT-002, CLOUD-001 | Planned | UI + Platform | Phase J |
| INT-001 | Integrations | Add AI integration manager (MCP client setup/verification including ChatGPT-path policy controls) | `packages/ui/src/app/settings/*`, CLI/bootstrap modules | Tenant admins can configure and verify integrations with explicit policy boundaries | UI-ENT-002 | Planned | Platform + UI | Phase J |
| SEC-001 | Security | Tenant security hardening for hybrid runtime (key rotation, connector trust, audit immutability checks) | daemon auth modules, connector auth, cloud auth/policy modules | Security controls are enforced and verifiable in audit and runtime posture | CLOUD-001 | Planned | Security + Platform | Phase K |
| OPS-001 | Operations | Define SLOs, telemetry pipelines, and incident runbooks for connector/cloud/runtime | `docs/*`, telemetry modules, operations scripts | SLO dashboards and runbooks exist and are used in canary/incident workflows | CONN-001, CLOUD-001 | Planned | Platform + SRE | Phase K |

<!-- | GOV-01 | Governance | Apply branch protection and label baseline | GitHub settings + scripts | Branch rules and labels enforced in target repos | None | In Progress | Repo Admin | Phase E | -->
<!-- | GOV-02 | Governance | Re-enable workflows after explicit approval | `.github/workflows-disabled/*` and runbook | CI/governance/release workflows operational | GOV-01 | Planned | Repo Admin | Phase E | -->

## 7) Tracker (Working Board in This Same File)

| Task ID | Milestone | Task | Owner | Status | ETA | Blocker | PR/Issue |
|---|---|---|---|---|---|---|---|
| PKG-01 | Phase A | Publishable dependency graph cleanup | Platform | Done | 2026-02-22 | — | — |
| PKG-02 | Phase A | npm publish pipeline | Platform | Done | 2026-02-22 | — | — |
| PKG-03 | Phase A | Install/quickstart doc alignment | Product Docs | Done | 2026-02-22 | — | — |
| SVC-01 | Phase B | Windows service lifecycle | Platform | Done | 2026-02-22 | — | — |
| SVC-02 | Phase B | macOS launchd lifecycle | Platform | Done | 2026-02-22 | — | — |
| SVC-03 | Phase B | Linux systemd lifecycle | Platform | Done | 2026-02-22 | — | — |
| AUTH-01 | Phase C | CLI device code auth | Platform | Done | 2026-02-22 | — | — |
| AUTH-02 | Phase C | Daemon secure auth session state | Platform | Done | 2026-02-22 | — | — |
| AUTH-03 | Phase C | UI auth/connect setup flow | UI | Done | 2026-02-22 | — | — |
| SEC-01 | Phase C.1 | CI/CD auth token env var | Platform | Done | 2026-02-22 | — | — |
| SEC-02 | Phase C.1 | OS keyring credential storage | Platform | Done | 2026-02-22 | — | — |
| SEC-03 | Phase C.1 | Browser auto-open for device flow | Platform | Done | 2026-02-22 | — | — |
| SEC-04 | Phase C.1 | RFC 9700 compliance (scope, token_type, rotation) | Platform | Done | 2026-02-22 | — | — |
| SEC-05 | Phase C.1 | UI dashboard session auth gate | UI + Platform | Done | 2026-02-22 | — | — |
| SYNC-01 | Phase D | Encrypted sync pipeline | Platform | Done | 2026-02-22 | — | — |
| SYNC-02 | Phase D | Config system + sync observability | Platform + UI | Done | 2026-02-22 | — | — |
| MCP-01 | Phase D | MCP runtime posture exposure | Platform | Done | 2026-02-22 | — | — |
| UI-01 | Phase E | Sidebar placeholder cleanup | UI | Done | 2026-02-22 | — | — |
| UI-02 | Phase E | Landing CTA wiring | UI | Done | 2026-02-22 | — | — |
| UI-03 | Phase E | UI user-flow docs | Product Docs | Done | 2026-02-23 | UI-01, UI-02 | — |
| VIZ-01 | Phase F | Reagraph WebGL migration | UI | Done | 2026-02-23 | — | — |
| VIZ-02 | Phase F | Layout-switching (Force/Hierarchical/Clustered) | UI | Done | 2026-02-23 | — | — |
| DX-01 | Phase F | Legacy embedded-local-UI CLI path | Core | Superseded | 2026-02-24 | Replaced by DX-03 | — |
| DX-02 | Phase F | Standalone Desktop App | Core | Planned | TBD | DX-03 | TBD |
| DX-03 | Phase F | Hosted-UI-only CLI packaging model | Core | Planned | TBD | — | TBD |
| DX-04 | Phase F | `0ctx setup` first-run workflow | Core | Planned | TBD | DX-03 | TBD |
| ARCH-001 | Phase G | Semantic blackboard event runtime + gate evaluator | Platform | In Progress | TBD | SYNC-02, MCP-01 | TBD |
| CONN-001 | Phase H | Always-on connector service lifecycle and stream bridge | Platform | In Progress | TBD | ARCH-001 | TBD |
| CLOUD-001 | Phase I | Hosted control plane connector APIs + stream gateway | Platform + Cloud | In Progress | TBD | CONN-001 | TBD |
| SYNC-001 | Phase I | Sync mode enforcement (`local_only`/`metadata_only`/`full_sync`) | Platform + Cloud | In Progress | TBD | CLOUD-001 | TBD |
| UI-ENT-002 | Phase J | Hosted enterprise UI architecture rollout | UI | Planned | TBD | CLOUD-001, CONN-001 | TBD |
| UI-OPS-001 | Phase J | Hosted operations route and reliability controls | UI + Platform | Planned | TBD | UI-ENT-002, CLOUD-001 | TBD |
| INT-001 | Phase J | AI integration manager + ChatGPT-path controls | Platform + UI | Planned | TBD | UI-ENT-002 | TBD |
| SEC-001 | Phase K | Hybrid runtime security hardening | Security + Platform | Planned | TBD | CLOUD-001 | TBD |
| OPS-001 | Phase K | SLO/telemetry/runbook rollout | Platform + SRE | Planned | TBD | CONN-001, CLOUD-001 | TBD |

<!-- | GOV-01 | Phase E | Branch protection + labels apply | Repo Admin | In Progress | TBD | Repo settings access | TBD | -->
<!-- | GOV-02 | Phase E | Workflow re-enable rollout | Repo Admin | Planned | TBD | Approval gate | TBD | -->

## 8) Test Matrix

## Packaging and Install
- Clean machine install from npm registry.
- `0ctx` bin available globally post-install.
- `0ctx install --clients=all` succeeds without local source checkout.

## Service Lifecycle
- Service install/enable/disable/uninstall across Windows/macOS/Linux.
- Reboot test validates daemon auto-start.
- Kill process test validates restart policy.

## Auth and Connectivity
- Device code success, expiry, cancel, token refresh paths.
- Logout clears local credentials.
- Tenant reachability failures surface actionable errors.

## Security Hardening (Phase C.1)
- `CTX_AUTH_TOKEN` env var authentication works in CI/CD (no interactive flow).
- Tokens stored in OS keyring by default; `--insecure-storage` flag required for plaintext.
- Browser auto-opens verification URL; `--no-browser` suppresses.
- Device code request includes explicit `scope` parameter.
- Token response `token_type` validated as `Bearer`.
- Warning logged when auth server does not rotate refresh token.
- Unauthenticated users redirected to login page when accessing `/dashboard/*`.
- UI session cookie secured (HttpOnly, SameSite=Strict, Secure in production).
- Server actions reject requests without valid session.

## Sync
- Encrypted payload sync success.
- Offline queue accumulation and replay on reconnect.
- Retries/backoff and permanent failure handling.

## UI
- Setup wizard end-to-end.
- No dead-end sidebar or landing actions.
- Route-level operational flows remain functional.

## MCP
- Local operations work while cloud disconnected.
- Capability state reflects local-only/connected/degraded accurately.

## Blackboard Runtime
- Subscription/event delivery ordering and idempotency behavior.
- Gate raise/clear lifecycle and completion evaluator outcomes.
- Task lease claim/release under contention.

## Connector and Cloud
- Connector register/heartbeat/stream reconnect behavior.
- Offline queue replay and duplicate suppression.
- Capability API and policy API behavior for hosted UI.

## Sync Policy Enforcement
- `local_only`: no full payload egress.
- `metadata_only`: only allowed metadata fields leave machine.
- `full_sync`: full payload availability with tenant scoping and encryption.

## 9) Operational Runbooks

- Release prep and dry-run:
  - `docs/RELEASE.md`
- GitHub workflow enablement:
  - `docs/GITHUB_ENABLEMENT_RUNBOOK.md`
- UI IA:
  - `docs/UI_INFORMATION_ARCHITECTURE.md`

## 10) Explicit Assumptions

- Local-first behavior remains non-negotiable.
- Cloud sync is additive and must not block local graph operations.
- Hosted UI is primary enterprise surface; local UI packaging is deferred.
- Cloud control plane uses server-grade datastores; SQLite remains local edge datastore.
- Sync policy defaults to `metadata_only`, with admin override to `local_only` or `full_sync`.
- Workflows remain disabled until explicit re-enable approval.

## 11) Change Log (Append-Only)

- 2026-02-24: SYNC-001 (partial) implemented — added per-context sync policy model and migration (`contexts.syncPolicy`, default `metadata_only`), daemon `getSyncPolicy`/`setSyncPolicy` handlers with audit event `set_sync_policy`, sync-engine policy enforcement (`local_only` queue/push skip, `metadata_only` redacted encrypted metadata payload, `full_sync` full encrypted context dump), MCP tools (`ctx_sync_policy_get`, `ctx_sync_policy_set`), and CLI controls (`0ctx sync policy get/set`). Added daemon tests for sync-engine policy behavior and handler-level sync-policy audit coverage.
- 2026-02-24: DX-04/CONN-001 (partial) implemented — added setup/operator controls requested for enterprise rollout: `0ctx connector status --require-bridge`, `0ctx setup --dashboard-query`, `0ctx setup --skip-service`, and `0ctx setup --skip-bootstrap`. Setup can now enforce bridge/cloud posture while also supporting constrained-environment onboarding paths.
- 2026-02-24: DX-04/CONN-001 (partial) implemented — hardened setup workflow with strict enterprise controls: `0ctx setup --require-cloud`, `--wait-cloud-ready`, `--cloud-wait-timeout-ms`, `--cloud-wait-interval-ms`, and `--create-context=<name>`. Setup now enforces cloud-ready posture checks before completion when requested and can provision an initial context during onboarding.
- 2026-02-24: CONN-001 (partial) implemented — added machine-readable CLI outputs for automation: `0ctx setup --json`, `0ctx bootstrap --json`, `0ctx install --json`, `0ctx connector register --json`, and `0ctx connector verify --json`. Added quiet-path handling in bootstrap/install and updated CLI help/docs/test coverage.
- 2026-02-24: CONN-001 (partial) implemented — extracted connector queue drain logic into a dedicated CLI helper (`packages/cli/src/connector-queue-drain.ts`) and added targeted unit coverage for timeout/bridge-unsupported/drained branches (`packages/cli/test/connector-queue-drain.test.ts`). Added queue ops-log clear controls via `0ctx connector queue logs --clear` with confirm/dry-run safety.
- 2026-02-24: CONN-001 (partial) implemented — added `doctor` check `ops_log_writable` for early detection of local CLI ops-log permission/path issues; expanded install/quickstart docs with queue drain wait-reason troubleshooting guidance.
- 2026-02-24: CONN-001 (partial) implemented — added `0ctx connector queue logs` for local ops-audit tailing and strict drain exit controls (`--strict`/`--fail-on-retry`) so retry events can fail automation even if queue eventually drains.
- 2026-02-24: CONN-001 (partial) implemented — added `0ctx connector queue drain --wait` controls (`--timeout-ms`, `--poll-ms`) for bounded blocking drain behavior, plus local CLI operations audit logging for queue drain/purge actions (`~/.0ctx/ops.log`, override `CTX_CLI_OPS_LOG_PATH`). Added tests in `packages/cli/test/ops-log.test.ts` and updated CLI command/help coverage.
- 2026-02-24: CONN-001 (partial) implemented — added connector queue operations commands (`0ctx connector queue status|drain|purge`) with safe purge controls (`--dry-run`/`--confirm`), bounded drain batching, and queue status surfacing in CLI. Added queue retention/prune controls and expanded queue/runtime tests.
- 2026-02-24: CONN-001 (partial) implemented — added persistent connector event queue (`~/.0ctx/connector-event-queue.json`, override `CTX_CONNECTOR_QUEUE_PATH`) with dedupe, delivery ack/removal, retry backoff, and queue stats. Runtime now uses poll->enqueue->daemon-ack->cloud-flush semantics for blackboard events, and connector status includes event queue posture. Added tests in `packages/cli/test/connector-queue.test.ts` and expanded runtime coverage.
- 2026-02-24: CONN-001/CLOUD-001 (partial) implemented — added connector runtime blackboard event-bridge scaffold: daemon session/subscription cursor persistence in connector state, cycle-time event polling + cloud ingest attempt + daemon ack-on-success flow, 404-based event-ingest capability fallback, and connector status runtime event-bridge visibility. Added/updated tests in `packages/cli/test/connector-runtime.test.ts`, `packages/cli/test/cloud.test.ts`, and `packages/cli/test/connector.test.ts`.
- 2026-02-24: CONN-001 (partial) implemented — added preferred connector-native service command routing (`0ctx connector service <action>`) while keeping legacy `0ctx daemon service <action>` compatibility, and aligned install/quickstart/help docs to the connector-first service UX.
- 2026-02-24: CONN-001 (partial) implemented — updated managed service templates/modules across Windows/macOS/Linux to launch the connector runtime loop (`0ctx connector run --quiet`) instead of daemon-only entrypoints, enabling service-managed cloud bridge behavior while preserving existing service command surface.
- 2026-02-24: CONN-001 (partial) implemented — added connector runtime control loop (`0ctx connector run`) with daemon reachability checks, optional daemon autostart, periodic cloud registration/capability/heartbeat reconciliation, and persisted connector cloud state updates. Added runtime cycle unit tests (`packages/cli/test/connector-runtime.test.ts`).
- 2026-02-24: CLOUD-001 (partial) implemented — added CLI cloud control-plane client scaffold (`packages/cli/src/cloud.ts`) for connector registration, heartbeat, and capabilities with endpoint fallback handling and configurable base URL/timeout. Wired connector register/status/verify flows to use cloud APIs with local-first fallback and cloud-required mode flags, and persisted cloud registration metadata in connector state. Added cloud transport unit tests (`packages/cli/test/cloud.test.ts`).
- 2026-02-24: CONN-001 (partial) implemented — added CLI connector state module (`~/.0ctx/connector.json`) with machine registration persistence, wired `0ctx connector register/status/verify` to real runtime checks and JSON output, and integrated connector registration into `0ctx setup`. Added connector state unit tests (`packages/cli/test/connector.test.ts`).
- 2026-02-24: ARCH-001 (partial) implemented — added daemon blackboard event runtime foundation (`subscribeEvents`, `listSubscriptions`, `unsubscribeEvents`, `pollEvents`, `ackEvent`, `getBlackboardState`, `claimTask`, `releaseTask`, `resolveGate`) and mutation event emission hooks in handlers; wired runtime into daemon server; added daemon handler tests for subscription polling and task lease ownership; added MCP tools for blackboard/event/task/gate operations.
- 2026-02-24: DevX realignment applied — adopted hosted-UI-only packaging model, marked legacy embedded-local-UI path (`DX-01`) as superseded, and added `DX-03` (hosted-UI-only packaging) + `DX-04` (`0ctx setup` onboarding command) to Phase F.
- 2026-02-24: Added hybrid architecture workstream for semantic blackboard runtime + connector service + cloud control plane + hosted UI. Added new docs: `docs/SEMANTIC_BLACKBOARD_ARCHITECTURE.md`, `docs/HYBRID_STORAGE_AND_SYNC_MODEL.md`, `docs/CONNECTOR_SERVICE_ARCHITECTURE.md`, `docs/HOSTED_UI_PRODUCT_ARCHITECTURE.md`. Added backlog/tracker items `ARCH-001`, `CONN-001`, `CLOUD-001`, `SYNC-001`, `UI-ENT-002`, `UI-OPS-001`, `INT-001`, `SEC-001`, `OPS-001`.
- 2026-02-22: Created initial combined roadmap + tracker document with locked decisions, architecture, milestones, backlog, and test matrix.
- 2026-02-22: PKG-01 completed — replaced all `file:` dependency references with semver `^1.0.0` ranges, added `exports`, `files`, `publishConfig`, `prepublishOnly`, `repository` to all four publishable packages. Added `release:pack:dry` script to root.
- 2026-02-22: PKG-02 completed — added `scripts/release/publish-packages.ps1` (deterministic order, dry-run, OTP, version-consistency check), `release:publish:dry` and `release:publish` root npm scripts, updated `docs/RELEASE.md` publish section.
- 2026-02-22: PKG-03 completed — rewrote `docs/INSTALL.md` and `docs/QUICKSTART.md` to make npm global install the primary end-user path; separated developer/contributor steps; updated `docs/ONBOARDING.md` with full release script reference. Phase A complete.
- 2026-02-22: SVC-01 completed — added `0ctx daemon service install/enable/disable/uninstall/status/start/stop/restart` subcommands (Windows); new `packages/cli/src/service-windows.ts` module using WinSW + sc.exe; WinSW XML service config at `scripts/service/windows/0ctx-daemon.xml`; winsw optional dep in CLI; fixed MCP exports subpath types (TS2307); fixed CLI implicit-any lint errors.
- 2026-02-22: SVC-02 + SVC-03 completed — added macOS launchd (`service-macos.ts`, `scripts/service/macos/com.0ctx.daemon.plist`) and Linux systemd user-level (`service-linux.ts`, `scripts/service/linux/0ctx-daemon.service`) service modules; CLI dispatcher routes to correct platform module at runtime. Phase B complete.
- 2026-02-22: AUTH-01 completed — added `packages/cli/src/auth.ts` (RFC 8628 device-code flow, `~/.0ctx/auth.json` token store at 0o600, `commandAuthLogin/Logout/Status`); wired `0ctx auth login/logout/status` subcommands into CLI; `CTX_AUTH_SERVER` env override; graceful failure when no server reachable.
- 2026-02-22: AUTH-02 completed — added `packages/daemon/src/auth.ts` (read-only token store reader, `AuthState` type); extended `health` IPC response with `auth` field; added `auth/status` IPC method; updated `getCapabilities` features + methods list.
- 2026-02-22: AUTH-03 completed — new `/dashboard/settings` UI route (auth state panel, CLI reference, daemon health passthrough); `getAuthStatus()` server action; Settings nav item in sidebar; dead-end Docs/Help support buttons wired to GitHub links. Phase C complete.
- 2026-02-22: UI-01 + UI-02 completed — Extensions sidebar items wired to `/dashboard/operations?client=<name>`; landing page "See architecture" and "Data model" CTAs wired to GitHub README/docs. Phase E (partial) complete.
- 2026-02-22: Security audit performed — multi-role review (Security Engineer, Product Architect, DevOps, Compliance) against RFC 9700, OWASP, GitHub CLI / gcloud / AWS CLI patterns. 7 gaps identified; added SEC-01..SEC-04 to backlog as Phase C.1 (security hardening before sync).
- 2026-02-22: Added SEC-05 (UI session auth gate) — dashboard has no access control; unauthenticated users can access all routes. Requires PKCE browser flow, Next.js middleware, and protected server actions.
- 2026-02-22: SEC-01 + SEC-03 + SEC-04 completed — added `CTX_AUTH_TOKEN`/`CTX_AUTH_TOKEN_FILE` env var bypass with `resolveToken()` + `getEnvToken()` (CLI + daemon); auto-open browser on login (platform-specific, `--no-browser` to suppress); `scope` param in device code request; `token_type` validation per RFC 6749 §5.1; refresh token rotation warning per RFC 9700 §4.14. Phase C.1 (partial) complete.
- 2026-02-22: SEC-02 completed — new `packages/cli/src/keyring.ts` wrapping `cross-keychain` (dynamic import, flat API); `writeTokenStoreSecure` / `readTokenStoreSecure` / `clearTokenStoreSecure` in auth.ts; `--insecure-storage` flag for CI/headless. Token precedence: env var > keyring > file.
- 2026-02-22: SEC-05 completed — `@auth0/nextjs-auth0` v4 SDK; `proxy.ts` protects `/dashboard/*` with Auth0 session check; `lib/auth0.ts` shared client; `app/login/page.tsx` styled login page; `.env.example` with Auth0 setup instructions; Sign out link in sidebar. Phase C.1 complete.
- 2026-02-22: SYNC-01 completed — Encrypted sync pipeline: `sync-queue.ts` (SQLite-backed persistent queue with dedup, retry/backoff, cleanup), `sync-transport.ts` (HTTPS push/pull, zero deps), `sync-engine.ts` (background orchestrator with timer, enqueue-on-mutate). Wired into `server.ts` lifecycle + `handlers.ts` mutation hooks. New `syncStatus` and `syncNow` method handlers. 10 new unit tests. Opt-in via `CTX_SYNC_ENABLED=1`.
- 2026-02-22: SYNC-02 completed — Global config system: `config.ts` in core (`~/.0ctx/config.json`, env→config→default resolution). CLI `0ctx config list/get/set` + `0ctx sync status`. Auth login auto-sets `sync.enabled`+`sync.endpoint` in config. Daemon reads config for sync enabled/endpoint. Health handler includes sync status. Help text updated.
- 2026-02-22: MCP-01 completed — Added `ctx_runtime_status` MCP tool: computes posture (connected/degraded/offline) from daemon health (auth + sync state). Exposes capabilities list, auth details, and sync queue status. Added `sync` to daemon `getCapabilities` features. Phase D complete.
- 2026-02-23: UI-03 completed — Updated `docs/UI_INFORMATION_ARCHITECTURE.md` to reflect Auth0 session ownership and global sync observability within the Dashboard Shell. Created `docs/UI_USER_FLOWS.md` detailing 5 primary journeys: Authentication -> Workspace Interaction -> Sync Observability -> Diagnostics -> Audit.
- 2026-02-23: VIZ-01 completed — Migrated the workspace graph renderer from the 2D Canvas `react-force-graph-2d` to the WebGL-based `reagraph`. Implemented custom theme mapping, updated node selection hooks, and verified browser interaction.
- 2026-02-23: VIZ-02 completed — Implemented layout switching in the workspace view. Added segmented toggle controls allowing switching between physics-based Force layout, Tree-based Hierarchical layout, and type-grouped Clustered layouts via `reagraph` APIs. Phase F continues.
