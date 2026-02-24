# Hosted UI Product Architecture

Updated: 2026-02-24  
Owner: Product + UI Platform

Related:
- `docs/UI_INFORMATION_ARCHITECTURE.md`
- `docs/UI_BFF_API_CONTRACT.md`
- `docs/HOSTED_UI_ONBOARDING_SPEC.md`
- `docs/HYBRID_STORAGE_AND_SYNC_MODEL.md`

## 1) Product Goal

Deliver an enterprise-grade hosted UI that controls and observes local runtime behavior through connector-mediated cloud APIs, without requiring users to run a local Next.js app.

## 2) Canonical Runtime Boundary

- Browser renders hosted UI routes.
- Hosted UI calls BFF endpoints (`/api/v1/*`).
- BFF calls cloud control-plane APIs.
- Cloud control plane communicates with local connector.
- Connector communicates with local daemon.

Hosted UI must not:
- spawn local CLI commands directly.
- connect to local daemon sockets directly.

## 3) Current Gap Snapshot

Current implementation still includes local coupling in hosted UI code paths:
- server actions that shell out to local CLI flows.
- direct daemon socket client usage.

Required closure:
- migrate runtime actions to BFF route handlers with typed contracts.
- enforce hosted-only interaction model in all dashboard routes.

## 4) Information Architecture

See `docs/UI_INFORMATION_ARCHITECTURE.md` for the full route map and dashboard ownership model.

## 5) UX Constraints

- No dead-end navigation items.
- Capability-gated actions with explicit reason when unavailable.
- Runtime posture always visible: `connected`, `degraded`, `offline`.
- Context sync policy visible: `local_only`, `metadata_only`, `full_sync`.
- Onboarding progress explicitly tracked and persisted.

## 6) Data Flow (Hosted)

```text
Browser UI
  -> /api/v1/* (Next.js BFF)
    -> Control Plane API
      -> Connector Bridge
        -> Local Daemon
```

Mutating actions must include:
- auth/session validation
- tenant scope enforcement
- correlation IDs and structured error envelopes

## 7) Capability Gating

Navigation and controls are driven by capability posture:
- feature unavailable: hide or disable with reason.
- degraded runtime: route remains accessible with restricted controls.

## 8) Design System Direction

- Enterprise shell first: dense, readable, deterministic UI behavior.
- Isometric visuals only for hero and empty states.
- Respect reduced motion and WCAG AA contrast.

## 9) Performance and Accessibility Budgets

Performance targets:
- first meaningful paint under 2.5s on primary routes under normal load.
- graph modules lazy-loaded.

Accessibility targets:
- full keyboard navigation on core workflows.
- reduced-motion support for transitions and animations.
- WCAG AA contrast baseline.

## 10) Integration Surface

Hosted UI includes:
- integration policy controls
- MCP bootstrap status and execution flows
- connector posture and queue controls

All controls must map to BFF endpoints documented in `docs/UI_BFF_API_CONTRACT.md`.
