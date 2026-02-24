# UI User Flows

Updated: 2026-02-24

This document describes the route-level user journeys for the hosted dashboard UI.

## 1. Authentication Flow

Scenario: user opens the product for the first time.
Primary route: `/` -> `/api/auth/login` -> `/dashboard/workspace`

1. User opens `/` and selects sign-in.
2. Auth middleware/session routes complete login callback.
3. User lands in `/dashboard/workspace` with active shell navigation and context list.

## 2. Workspace Graph Flow

Scenario: user explores and edits context graph data.
Primary route: `/dashboard/workspace`

1. User selects active context from sidebar.
2. Workspace loads graph via `getGraphData`.
3. User edits node content/tags or creates a new node.
4. Changes persist through daemon APIs and appear in graph + inspector.

## 3. Operations Runbook Flow

Scenario: user validates and repairs local runtime health.
Primary route: `/dashboard/operations`

1. User runs install/status/doctor/bootstrap/repair workflows from runbook actions.
2. UI executes CLI-backed workflows and shows structured output/state.
3. User opens diagnostics runtime controls to inspect connector posture and queue lag.
4. User drains queue, previews purge impact, and reviews queue logs without opening terminal.

## 4. Integrations + Connector Flow

Scenario: user configures AI client integrations and connector bridge health.
Primary route: `/dashboard/integrations`

1. User selects target clients (`claude`, `cursor`, `windsurf`).
2. User runs bootstrap detect/apply and connector verify/register flows.
3. User checks connector posture and queue status cards.
4. User sets integration policy boundaries (`integration.chatgpt.enabled`, `integration.chatgpt.requireApproval`, `integration.autoBootstrap`).
5. User drains queue when needed and confirms operational result.

## 5. Audit + Backup Flow

Scenario: user reviews change history and recovery points.
Primary routes: `/dashboard/audit`, `/dashboard/backups`

1. Audit route shows scoped audit events (active context or all contexts).
2. Backups route creates encrypted backups and lists existing artifacts.
3. User restores backup into a context and verifies refresh/audit updates.

## 6. Policy + Completion Flow

Scenario: user governs sync and completion readiness for the active context.
Primary route: `/dashboard/settings`

1. User reviews auth/tenant state.
2. UI evaluates blackboard completion (`evaluateCompletion`) for active context.
3. User reads blocking reasons (gates/leases/events) if incomplete.
4. User sets sync policy (`local_only`, `metadata_only`, `full_sync`) and saves.
5. User validates connector posture in header badges before moving back to operations/integrations.
