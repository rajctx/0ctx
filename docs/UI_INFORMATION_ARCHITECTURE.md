# UI Information Architecture

Updated: 2026-02-24

Related tracking:

- `docs/ENTERPRISE_ROADMAP_AND_TRACKER.md`

## Goals

- Keep each dashboard route focused on one operational concern.
- Preserve a consistent enterprise shell (navigation, context switching, health/status) across all views.
- Avoid mixing graph editing, diagnostics, audit, and backup workflows on one page.

## Route Map

- `/`
  - Public landing page with product messaging and CTAs linking to `/api/auth/login`.
- `/login`, `/api/auth/*`
  - Next.js Auth0 universal login routes (session negotiation, callbacks, logout).
- `/dashboard`
  - Authenticated session requirement (enforced by middleware).
  - Compatibility entrypoint; redirects to `/dashboard/workspace`.
- `/dashboard/workspace`
  - Graph visualization, node inspector, edit/delete actions, and graph controls.
- `/dashboard/operations`
  - Runbook/diagnostics workflows (`install`, `status`, `doctor`, `bootstrap`, `repair`).
- `/dashboard/integrations`
  - Integration manager workflows (MCP bootstrap detect/apply, connector status/verify/register, queue status/drain).
- `/dashboard/audit`
  - Audit event visibility and scope filtering.
- `/dashboard/backups`
  - Backup create/list/restore workflows.
- `/dashboard/settings`
  - Auth state, context completion evaluator, and per-context sync policy controls.

## Shared Shell Responsibilities

Implemented in dashboard layout/shell (`DashboardShell`):

- Global authentication enforcement (redirecting unauthenticated requests).
- Route navigation for Workspace, Operations, Integrations, Audit, Backups, Settings.
- Active-context list and context creation sidebar.
- Sign-out action.
- Top status strip:
  - daemon health state (Connected/Degraded/Offline)
  - active capability counts
  - context request metrics.
- Background polling for shared dashboard state.

## State Ownership

- Shared dashboard context provider owns:
  - available workspace contexts + active context selection
  - daemon health/metrics/capabilities snapshots
  - continuous background polling for runtime status.
- Route-specific pages own local interaction state:
  - `/dashboard/workspace`: graph layout geometry, active node inspector state, mutation forms
  - `/dashboard/operations`: runbook and diagnostics command execution state
  - `/dashboard/integrations`: connector integration execution state and queue operational controls
  - `/dashboard/audit`: log pagination and filters
  - `/dashboard/backups`: upload dialogs and action in-progress spinners
  - `/dashboard/settings`: auth/status snapshots, completion evaluation, and sync policy editing state.

## Design Constraints

- Keep enterprise visual language consistent with existing dark shell.
- Minimize floating overlays outside focused task areas.
- Preserve keyboard access patterns where applicable.
