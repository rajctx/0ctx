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
| DX-01 | Platform | Unified NPM Global Install: Make `@0ctx/cli` the single entry point. Bundle/embed the UI and auto-start the daemon. | `packages/cli/*`, `packages/ui/*` | Users run `npm install -g @0ctx/cli` and `0ctx` handles everything | None | Done | Core | Phase F |
| DX-02 | Platform | Desktop App: Bundle everything into a standalone local desktop application (Tauri/Electron) | `desktop-app/*` | Users download an installer and get a system tray app serving the UI | DX-01 | Planned | Core | Phase F |

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
| DX-01 | Phase F | Unified NPM Install (`@0ctx/cli`) | Core | Done | 2026-02-23 | — | — |
| DX-02 | Phase F | Standalone Desktop App | Core | Planned | TBD | DX-01 | TBD |

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
