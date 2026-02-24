# Hosted UI Onboarding Spec

Updated: 2026-02-24  
Owner: Product + UI Platform

## Goal

Provide a deterministic first-run experience for enterprise users where local runtime readiness and hosted UI readiness are explicit and verifiable.

## Primary Route

- `/install`

This route is the canonical onboarding surface after CLI setup handoff (`0ctx setup`).

## Onboarding Steps

1. `Install CLI`
- check: CLI installed and callable (`0ctx --help` or equivalent status signal).

2. `Authenticate`
- check: valid user session for hosted UI and tenant binding.

3. `Connector Registered`
- check: machine registration exists in control plane.

4. `Bridge Healthy`
- check: connector bridge is healthy and can execute controlled runtime actions.

5. `MCP Clients Detected`
- check: bootstrap detect reports supported client integration state.

6. `First Context Created`
- check: active context exists and is selectable in dashboard shell.

## State Contract

- `OnboardingStepStatus = 'todo' | 'in_progress' | 'blocked' | 'done'`
- `RuntimePosture = 'connected' | 'degraded' | 'offline'`

Each step must include:
- `status`
- `message`
- `lastCheckedAt`
- `action` (optional guided recovery operation)

## UX Constraints

- No hidden blockers: all failed checks must show a direct remediation action.
- No ambiguous success states: each step is binary pass/fail with in-progress transitional state.
- No terminal dependency for core onboarding: guided actions should run from hosted UI where capability allows.

## Failure Handling

Common blocked states:
- connector not registered
- cloud unreachable
- bridge unsupported/degraded
- auth session expired

Required behavior:
- show blocking step and reason.
- show only relevant remediation actions for current state.
- preserve progression; do not reset completed steps unless state regresses.

## Acceptance Criteria

- User can complete onboarding without source checkout.
- All six steps are visible and actionable.
- Hosted UI status reflects connector/cloud state within one polling interval.
- Onboarding completion state is persisted and re-loadable.
