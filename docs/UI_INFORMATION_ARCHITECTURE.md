# UI Information Architecture

Updated: 2026-02-24

Related:
- `docs/HOSTED_UI_PRODUCT_ARCHITECTURE.md`
- `docs/HOSTED_UI_ONBOARDING_SPEC.md`
- `docs/UI_BFF_API_CONTRACT.md`
- `docs/ENTERPRISE_ROADMAP_AND_TRACKER.md`

## Goals

- Keep each route focused on one operational concern.
- Maintain a consistent enterprise shell across authenticated routes.
- Keep onboarding explicit and verifiable.
- Avoid mixed concerns (graph editing + ops + backup in one surface).

## Route Map

## Public

- `/`
  - landing with product narrative and CTA into onboarding/dashboard.
- `/install`
  - guided onboarding checklist and runtime readiness.
- `/docs`
  - documentation index and runbook pointers.
- `/login`, `/auth/*`
  - Auth0 login/logout/callback/session flow.

## Authenticated

- `/dashboard`
  - compatibility entrypoint; redirects to `/dashboard/workspace`.
- `/dashboard/workspace`
  - graph exploration and context editing.
- `/dashboard/operations`
  - runtime diagnostics and remediation controls.
- `/dashboard/integrations`
  - AI integration setup and policy controls.
- `/dashboard/audit`
  - audit event visibility and filtering.
- `/dashboard/backups`
  - backup create/list/restore workflows.
- `/dashboard/settings`
  - auth/session state, completion evaluation, sync policy controls.

## Authentication and Guarding

- `/dashboard/*` and `/api/v1/*` require authenticated session.
- Session enforcement is owned by active `proxy.ts`.
- Unauthenticated access redirects to login with return path preserved.

## Shared Shell Responsibilities

Implemented by dashboard shell/layout:
- global nav and route context
- active context selector
- runtime posture indicators
- connector/cloud posture badges
- refresh/reload controls

## State Ownership

- Shared provider:
  - active context
  - posture snapshots
  - capability state
- Route-local state:
  - page-specific form/workflow state
  - operation result panels
  - filters, pagination, transient feedback

## Design Constraints

- Enterprise readability over decorative visuals.
- Isometric visuals limited to hero/empty states.
- No floating controls that hide operational context.
- Full keyboard access for primary actions.
