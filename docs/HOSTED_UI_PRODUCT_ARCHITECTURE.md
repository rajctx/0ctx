# Hosted UI Product Architecture

Updated: 2026-02-24  
Owner: Product + UI Platform

Related:
- `docs/SEMANTIC_BLACKBOARD_ARCHITECTURE.md`
- `docs/HYBRID_STORAGE_AND_SYNC_MODEL.md`
- `docs/UI_INFORMATION_ARCHITECTURE.md`

## 1) Product Goal

Deliver an enterprise-grade hosted UI that manages local connector fleets and blackboard workflows without requiring users to run a local Next.js app.

## 2) Information Architecture

Public:
- `/` landing
- `/install` connect local runtime guide
- `/docs` product docs index

Authenticated app:
- `/workspace` semantic blackboard + context graph
- `/operations` connector/daemon health and runtime controls
- `/audit` tenant audit timeline and event forensics
- `/backups` backup/restore workflows and status
- `/settings` org, policy, sync mode, and integration controls

## 3) UX Constraints

- No dead-end navigation items.
- Every visible action must map to a working backend capability.
- Runtime posture is always visible: `connected`, `degraded`, `offline`.
- Sync mode label is visible at context scope: `local_only`, `metadata_only`, `full_sync`.

## 4) Design System Direction

- Use modern enterprise shell with strict hierarchy and dense information clarity.
- Isometric visual language is used intentionally for hero/overview surfaces, not as decorative noise on every panel.
- Keep typography and motion tokenized; respect reduced-motion settings.
- Maintain WCAG AA contrast for primary and secondary text states.

## 5) Core User Flows

1. First-time onboarding
- user runs `0ctx setup --clients=all`
- user signs in
- installs connector
- registers machine
- verifies daemon + MCP capability state

2. Context operations
- create/switch contexts
- inspect blackboard events
- apply policy and sync mode at context level

3. Agent workflow control
- view active tasks/gates
- claim/release and resolution actions
- inspect completion decision history

4. Reliability operations
- view queue lag and reconnect status
- run diagnostic workflows
- trigger backup/restore and review outcomes

## 6) State Model

Hosted UI reads from cloud APIs:
- tenant metadata
- connector health
- blackboard event projections
- policy state
- audit streams

The UI must not assume direct access to local daemon socket paths.

## 7) Capability Gating

Navigation and actions are driven by `capabilities` response:
- feature unavailable => hidden or disabled with explicit reason.
- partial outage => route remains available with degraded banners and restricted controls.

## 8) Performance and Accessibility Budgets

Performance targets:
- first meaningful paint under 2.5s for primary routes under normal load.
- heavy graph modules lazy-loaded.

Accessibility targets:
- keyboard navigation across all core workflows.
- reduced-motion support for transitions/animations.
- WCAG AA contrast baseline.

## 9) Integration Surface

Hosted UI includes AI client integration management:
- MCP integration status
- setup and verification flows
- per-tenant policy controls for client/tool exposure

This includes ChatGPT-path support where connector and tenant policy allow it.
