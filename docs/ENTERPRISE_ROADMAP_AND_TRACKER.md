# 0ctx Enterprise Productization Roadmap + Tracker

Last updated: 2026-02-22  
Document owner: Platform + Product

Status legend:
- `Planned`
- `In Progress`
- `Blocked`
- `Done`

## 1) Locked Decisions

- Product model: managed cloud + local agent.
- Distribution path: npm registry (`@0ctx` scope), no repo clone required for end users.
- Auth model: device code login + API tokens.
- Data model: full encrypted sync.
- Tenancy model: single-tenant deployments first.
- Runtime behavior: daemon runs as managed OS service with auto-start after reboot on Windows, macOS, and Linux.

## 2) Target User Experience (No Clone)

1. User installs CLI:
   - `npm install -g @0ctx/cli`
2. User authenticates:
   - `0ctx auth login`
3. User installs and enables background service:
   - `0ctx daemon service install`
   - `0ctx daemon service enable`
4. User bootstraps MCP clients:
   - `0ctx install --clients=all`
5. User opens UI and completes setup wizard:
   - install check
   - auth status
   - tenant connectivity
   - daemon health
   - MCP registration state
6. After system reboot:
   - daemon auto-starts
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

## 3.3 Managed Cloud + Single-Tenant Connectivity

- Control-plane concerns:
  - org/workspace identity
  - policy state
  - device registration
- Single-tenant deployment concerns:
  - tenant endpoint binding
  - encrypted data channel
  - operational isolation
- Local daemon is still system of record for online/offline operations; cloud sync is asynchronous.

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

## 3.6 MCP Runtime Behavior

- MCP remains local and functional when cloud connectivity is degraded.
- Add health/capability indicators for:
  - local-only mode
  - connected mode
  - degraded mode
- Cloud failures must not break local CRUD or context retrieval.

## 4) Current Gaps Snapshot

- Packaging flow is not yet fully aligned to no-clone install outcome.
- Cross-OS service manager integration is not implemented.
- Some UI shell items are placeholders with no real destination.
- Install/release docs still need final alignment to publish + service + auth journey.
- Cloud connection/auth/sync surfaces are not yet fully implemented.

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

## 6) Implementation Backlog (Decision-Complete)

| ID | Area | Description | Files to Update | Acceptance Criteria | Dependencies | Status | Owner | Milestone |
|---|---|---|---|---|---|---|---|---|
| PKG-01 | Packaging | Make package dependency graph publishable and no-clone compatible | `packages/*/package.json` | Published installs no longer require local workspace paths | None | Done | Platform | Phase A |
| PKG-02 | Release | Add publish orchestration for npm in deterministic order | root `package.json`, `docs/RELEASE.md`, release scripts | Single command path can validate and publish packages | PKG-01 | Done | Platform | Phase A |
| PKG-03 | Docs | Align INSTALL/QUICKSTART with real packaged install path | `docs/INSTALL.md`, `docs/QUICKSTART.md` | Docs match actual end-user install behavior | PKG-01, PKG-02 | Done | Product Docs | Phase A |
| SVC-01 | CLI/Daemon | Add Windows service lifecycle commands and health checks | `packages/cli/src/index.ts`, service scripts | Daemon auto-starts and is manageable after reboot on Windows | PKG-01 | Done | Platform | Phase B |
| SVC-02 | CLI/Daemon | Add macOS launchd lifecycle commands | CLI + `scripts/service/macos/*` | Daemon auto-starts and is manageable after reboot on macOS | PKG-01 | Done | Platform | Phase B |
| SVC-03 | CLI/Daemon | Add Linux systemd lifecycle commands | CLI + `scripts/service/linux/*` | Daemon auto-starts and is manageable after reboot on Linux | PKG-01 | Done | Platform | Phase B |
| AUTH-01 | CLI | Device code login/logout and token refresh support | `packages/cli/src/index.ts` + auth module | `0ctx auth login/logout/status` works reliably | PKG-01 | Planned | Platform | Phase C |
| AUTH-02 | Daemon | Secure session/token persistence and tenant binding | `packages/daemon/src/*` | Daemon reports tenant/auth state with secure token handling | AUTH-01 | Planned | Platform | Phase C |
| AUTH-03 | UI | Auth/setup/connect flows in UI | `packages/ui/src/app/*`, `packages/ui/src/components/*` | User can complete auth and tenant binding from UI | AUTH-01, AUTH-02 | Planned | UI | Phase C |
| SYNC-01 | Daemon | Encrypted sync envelope, queue, retry/backoff | `packages/daemon/src/*` | Sync succeeds with encryption and retry semantics | AUTH-02 | Planned | Platform | Phase D |
| SYNC-02 | UI/CLI | Sync status and manual sync controls | UI routes/components + CLI command | User can inspect sync health and trigger sync | SYNC-01 | Planned | Platform + UI | Phase D |
| MCP-01 | MCP | Add runtime capability/status exposure for connected/degraded modes | `packages/mcp/src/*`, `packages/daemon/src/*` | MCP clients can query runtime connection posture | AUTH-02, SYNC-01 | Planned | Platform | Phase D |
| UI-01 | UI | Remove or wire non-functional sidebar/support/extension actions | `packages/ui/src/components/dashboard/dashboard-shell.tsx` | No dead-end primary UI actions remain | None | Planned | UI | Phase E |
| UI-02 | UI | Wire landing page secondary CTAs to real destinations | `packages/ui/src/app/page.tsx` | All visible CTAs have meaningful navigation | None | Planned | UI | Phase E |
| UI-03 | UI Docs | Expand UI flow documentation | `docs/UI_INFORMATION_ARCHITECTURE.md`, `docs/UI_USER_FLOWS.md` | Docs map route-by-route user journey and controls | UI-01, UI-02 | Planned | Product Docs | Phase E |
| GOV-01 | Governance | Apply branch protection and label baseline | GitHub settings + scripts | Branch rules and labels enforced in target repos | None | In Progress | Repo Admin | Phase E |
| GOV-02 | Governance | Re-enable workflows after explicit approval | `.github/workflows-disabled/*` and runbook | CI/governance/release workflows operational | GOV-01 | Planned | Repo Admin | Phase E |

## 7) Tracker (Working Board in This Same File)

| Task ID | Milestone | Task | Owner | Status | ETA | Blocker | PR/Issue |
|---|---|---|---|---|---|---|---|
| PKG-01 | Phase A | Publishable dependency graph cleanup | Platform | Done | 2026-02-22 | — | — |
| PKG-02 | Phase A | npm publish pipeline | Platform | Done | 2026-02-22 | — | — |
| PKG-03 | Phase A | Install/quickstart doc alignment | Product Docs | Done | 2026-02-22 | — | — |
| SVC-01 | Phase B | Windows service lifecycle | Platform | Done | 2026-02-22 | — | — |
| SVC-02 | Phase B | macOS launchd lifecycle | Platform | Done | 2026-02-22 | — | — |
| SVC-03 | Phase B | Linux systemd lifecycle | Platform | Done | 2026-02-22 | — | — |
| AUTH-01 | Phase C | CLI device code auth | Platform | Planned | TBD | PKG-01 | TBD |
| AUTH-02 | Phase C | Daemon secure auth session state | Platform | Planned | TBD | AUTH-01 | TBD |
| AUTH-03 | Phase C | UI auth/connect setup flow | UI | Planned | TBD | AUTH-01, AUTH-02 | TBD |
| SYNC-01 | Phase D | Encrypted sync pipeline | Platform | Planned | TBD | AUTH-02 | TBD |
| SYNC-02 | Phase D | Sync observability in UI/CLI | Platform + UI | Planned | TBD | SYNC-01 | TBD |
| MCP-01 | Phase D | MCP capability/degraded mode exposure | Platform | Planned | TBD | AUTH-02, SYNC-01 | TBD |
| UI-01 | Phase E | Sidebar placeholder cleanup | UI | Planned | TBD | None | TBD |
| UI-02 | Phase E | Landing CTA wiring | UI | Planned | TBD | None | TBD |
| UI-03 | Phase E | UI user-flow docs | Product Docs | Planned | TBD | UI-01, UI-02 | TBD |
| GOV-01 | Phase E | Branch protection + labels apply | Repo Admin | In Progress | TBD | Repo settings access | TBD |
| GOV-02 | Phase E | Workflow re-enable rollout | Repo Admin | Planned | TBD | Approval gate | TBD |

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
- Single-tenant deployment requirement remains first enterprise target.
- Workflows remain disabled until explicit re-enable approval.

## 11) Change Log (Append-Only)

- 2026-02-22: Created initial combined roadmap + tracker document with locked decisions, architecture, milestones, backlog, and test matrix.
- 2026-02-22: PKG-01 completed — replaced all `file:` dependency references with semver `^1.0.0` ranges, added `exports`, `files`, `publishConfig`, `prepublishOnly`, `repository` to all four publishable packages. Added `release:pack:dry` script to root.
- 2026-02-22: PKG-02 completed — added `scripts/release/publish-packages.ps1` (deterministic order, dry-run, OTP, version-consistency check), `release:publish:dry` and `release:publish` root npm scripts, updated `docs/RELEASE.md` publish section.
- 2026-02-22: PKG-03 completed — rewrote `docs/INSTALL.md` and `docs/QUICKSTART.md` to make npm global install the primary end-user path; separated developer/contributor steps; updated `docs/ONBOARDING.md` with full release script reference. Phase A complete.
- 2026-02-22: SVC-01 completed — added `0ctx daemon service install/enable/disable/uninstall/status/start/stop/restart` subcommands (Windows); new `packages/cli/src/service-windows.ts` module using WinSW + sc.exe; WinSW XML service config at `scripts/service/windows/0ctx-daemon.xml`; winsw optional dep in CLI; fixed MCP exports subpath types (TS2307); fixed CLI implicit-any lint errors.
- 2026-02-22: SVC-02 + SVC-03 completed — added macOS launchd (`service-macos.ts`, `scripts/service/macos/com.0ctx.daemon.plist`) and Linux systemd user-level (`service-linux.ts`, `scripts/service/linux/0ctx-daemon.service`) service modules; CLI dispatcher routes to correct platform module at runtime. Phase B complete.
