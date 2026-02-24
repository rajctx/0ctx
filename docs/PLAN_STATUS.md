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

## In Progress

- Branch protection and label policy rollout in GitHub settings.
- GitHub workflow enablement rollout remains pending (workflows stay disabled for now).

## Planned

- Publish pipeline for package-based distribution.
- Release automation phase 2 (GitHub workflow-backed publish and release publication).
- `ARCH-001`: Semantic Blackboard runtime (events, subscriptions, gate evaluator).
- `CONN-001`: Always-on local connector service (Windows/macOS/Linux).
- `CLOUD-001`: Hosted control plane APIs and connector stream gateway.
- `SYNC-001`: Policy-based sync (`local_only`, `metadata_only`, `full_sync`) and reconciliation.
- `UI-ENT-002`: Hosted enterprise UI architecture rollout.
- `UI-OPS-001`: Hosted operations route with connector health, queue lag, and diagnostics controls.
- `DX-03`: Hosted-UI-only CLI packaging model (no embedded local UI runtime for end users).
- `DX-04`: Canonical `0ctx setup` first-run workflow.
- `INT-001`: AI integration manager and ChatGPT-path support policy controls.
- `SEC-001`: Tenant security and key management hardening.
- `OPS-001`: SLO, observability, and incident runbooks for hybrid runtime.

## Recently Landed

- Hybrid architecture plan and canonical documents were added for execution kickoff:
  - `docs/SEMANTIC_BLACKBOARD_ARCHITECTURE.md`
  - `docs/HYBRID_STORAGE_AND_SYNC_MODEL.md`
  - `docs/CONNECTOR_SERVICE_ARCHITECTURE.md`
  - `docs/HOSTED_UI_PRODUCT_ARCHITECTURE.md`
- Distribution model realigned to hosted-UI-only runtime; legacy embedded-local-UI path marked superseded (`DX-01`).
