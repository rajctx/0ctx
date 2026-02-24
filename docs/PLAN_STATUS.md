# Plan Status

Updated: 2026-02-24

## Canonical Tracker

- Primary roadmap and execution tracker: `docs/ENTERPRISE_ROADMAP_AND_TRACKER.md`
- Runtime architecture: `docs/SEMANTIC_BLACKBOARD_ARCHITECTURE.md`
- Storage and sync contract: `docs/HYBRID_STORAGE_AND_SYNC_MODEL.md`
- Connector architecture: `docs/CONNECTOR_SERVICE_ARCHITECTURE.md`
- Hosted UI architecture: `docs/HOSTED_UI_PRODUCT_ARCHITECTURE.md`

## Completed

- Core/daemon/mcp enterprise hardening baseline.
- MCP auto-bootstrap for supported clients.
- Product CLI baseline (`install`, `bootstrap`, `doctor`, `status`, `repair`).
- CI, issue templates, PR template, governance docs.
- Repo scripts for nested-git detection and UI migration.
- `packages/ui` monorepo adoption completed (no nested package-level `.git` tracking remains).
- UI enterprise operations surface for install/status/bootstrap/doctor/repair workflows.
- UI diagnostics and operations panels for daemon status, audit trail, and backups.
- UI route split delivery completed for app flows and operations views.
- UI information architecture documentation published (`docs/UI_INFORMATION_ARCHITECTURE.md`).
- Release automation phase 1 delivered (validate/changelog/tag dry-run scripts + release doc sequence).
- `ARCH-001` completed (blackboard subscriptions, leases/gates, and deterministic completion evaluator surfaced via daemon + MCP).
- `CONN-001` completed for local runtime scope (always-on connector lifecycle, event replay bridge, command bridge, queue controls, and service-managed runtime).
- `CLOUD-001` completed for repository scope (control-plane client + local dev reference control-plane APIs for registration/heartbeat/capabilities/events/commands).
- `SYNC-001` completed for local + connector egress scope (policy enforcement for `local_only`/`metadata_only`/`full_sync` across daemon sync and connector bridge paths).
- `DX-03` completed (hosted-UI-only packaging path is canonical; no local UI runtime in end-user CLI flow).
- `DX-04` completed (`0ctx setup` is the canonical one-command onboarding path with strict posture controls and hosted handoff).
- UI route split expanded with dedicated Integrations route and connector operations surface (`/dashboard/integrations`).
- Settings route expanded with active-context completion evaluation and sync policy management controls.
- `UI-ENT-002` completed for hosted/local-control-plane scope (capability-gated IA, dedicated integrations route, and no dead-end enterprise paths).
- `UI-OPS-001` completed for hosted/local-control-plane scope (operations diagnostics include connector posture, queue lag, drain/purge preview, and queue logs).
- `INT-001` completed for hosted/local-control-plane scope (integration manager includes ChatGPT-path and auto-bootstrap policy controls with persisted config boundaries).

## In Progress

- No non-governance engineering workstreams currently in progress.

## Planned

- Release automation phase 2 (GitHub workflow-backed publish and release publication).
- `SEC-001`: Tenant security and key management hardening.
- `OPS-001`: SLO, observability, and incident runbooks for hybrid runtime.

## Recently Landed

- Hybrid architecture plan and canonical documents were added for execution kickoff:
  - `docs/SEMANTIC_BLACKBOARD_ARCHITECTURE.md`
  - `docs/HYBRID_STORAGE_AND_SYNC_MODEL.md`
  - `docs/CONNECTOR_SERVICE_ARCHITECTURE.md`
  - `docs/HOSTED_UI_PRODUCT_ARCHITECTURE.md`
- Distribution model realigned to hosted-UI-only runtime; legacy embedded-local-UI path marked superseded (`DX-01`).
