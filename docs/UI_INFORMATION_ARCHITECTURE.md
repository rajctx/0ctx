# UI Information Architecture

Updated: 2026-02-22

Related tracking:

- `docs/ENTERPRISE_ROADMAP_AND_TRACKER.md`

## Goals

- Keep each dashboard route focused on one operational concern.
- Preserve a consistent enterprise shell (navigation, context switching, health/status) across all views.
- Avoid mixing graph editing, diagnostics, audit, and backup workflows on one page.

## Route Map

- `/dashboard`
  - Compatibility entrypoint.
  - Redirects to `/dashboard/workspace`.
- `/dashboard/workspace`
  - Graph visualization, node inspector, edit/delete actions, and graph controls.
- `/dashboard/operations`
  - Runbook/diagnostics workflows (`install`, `status`, `doctor`, `bootstrap`, `repair`).
- `/dashboard/audit`
  - Audit event visibility and scope filtering.
- `/dashboard/backups`
  - Backup create/list/restore workflows.

## Shared Shell Responsibilities

Implemented in dashboard layout/shell:

- Route navigation for Workspace, Operations, Audit, Backups.
- Active-context list and context creation.
- Top status strip:
  - daemon health state
  - capability method count
  - request count
  - last sync timestamp
- Refresh action for shared dashboard state.

## State Ownership

- Shared dashboard state provider owns:
  - contexts + active context
  - daemon health/metrics/capabilities snapshots
  - cross-route refresh tick for sync updates
- Route pages own local behavior:
  - workspace graph and inspector state
  - operations/audit/backups view-local interaction state

## Design Constraints

- Keep enterprise visual language consistent with existing dark shell.
- Minimize floating overlays outside focused task areas.
- Preserve keyboard access patterns where applicable.
