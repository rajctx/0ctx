# UI User Flows

Updated: 2026-02-24

This document defines route-level user journeys for the hosted dashboard and onboarding surfaces.

## 1) First-time Onboarding Flow

Primary route: `/install`

1. User arrives from CLI handoff (`0ctx setup`) or direct navigation.
2. UI loads onboarding checklist steps.
3. User resolves blocked steps in order:
   - authenticate
   - connector registration
   - bridge health
   - MCP detection
4. User creates/selects initial context.
5. UI marks onboarding complete and routes to `/dashboard/workspace`.

## 2) Authentication Flow

Primary route: `/` -> `/auth/login` -> `/dashboard/workspace`

1. User selects sign-in.
2. Auth0 login and callback complete.
3. Protected routes load with active session.

## 3) Workspace Graph Flow

Primary route: `/dashboard/workspace`

1. User selects active context.
2. UI loads graph projection for context.
3. User performs graph operations.
4. UI reflects updated state and audit projections.

## 4) Operations Runbook Flow

Primary route: `/dashboard/operations`

1. User runs diagnostics or repair workflow via hosted actions.
2. UI shows structured command/status output.
3. User inspects connector posture and queue health.
4. User performs drain/purge-preview controls when available.

## 5) Integrations and Policy Flow

Primary route: `/dashboard/integrations`

1. User selects target AI clients.
2. User runs bootstrap detect/apply and connector verify/register.
3. User reviews queue and bridge status.
4. User updates integration policy toggles.
5. UI confirms saved policy state.

## 6) Audit and Backup Flow

Primary routes: `/dashboard/audit`, `/dashboard/backups`

1. User reviews scoped audit events.
2. User creates encrypted backups.
3. User restores selected backup into a context.
4. UI refreshes audit/backup state and shows operation result.

## 7) Settings and Governance Flow

Primary route: `/dashboard/settings`

1. User reviews auth/tenant/session state.
2. User evaluates completion readiness for active context.
3. User updates sync policy.
4. User validates resulting runtime posture.
