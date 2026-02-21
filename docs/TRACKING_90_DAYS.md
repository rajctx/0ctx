# 90-Day Tracking Plan

Status legend:

- `[x]` completed
- `[-]` in progress
- `[ ]` planned

## Sprint 1 (Days 1-30): Core Stabilization

### Epic
- Core graph and persistence stability.

### Issues
- [x] Schema migration safety checks.
- [x] Encryption/key lifecycle hardening.
- [x] Backup/export/import reliability checks.

### Acceptance
- [x] `npm run test` stable with no flaky failures.
- [x] Migration path verified on fresh + existing DBs.
- [x] Backup/restore roundtrip validated.

## Sprint 2 (Days 31-60): Daemon Reliability

### Epic
- Harden daemon runtime behavior.

### Issues
- [x] Request envelope and capability/version surface added.
- [x] Metrics and health observability polish.
- [-] Daemon recovery and restart robustness.

### Acceptance
- [x] Health and metrics endpoints reliable.
- [x] Structured logs contain request/session trace fields.
- [-] Failure scenarios have deterministic recovery behavior.

## Sprint 3 (Days 61-90): Product Surface (CLI/MCP/UI)

### Epic
- Improve end-user activation and daily workflows.

### Issues
- [x] CLI install/bootstrap/doctor/status/repair baseline.
- [x] MCP bootstrap compatibility matrix update.
- [ ] UI install/status/repair wizard integration.
- [x] GitHub repo governance baseline (templates/docs/checks).
- [-] Nested `packages/ui` migration into monorepo tracking.

### Acceptance
- [x] First-time setup under 5 minutes for supported clients.
- [x] `0ctx doctor` produces actionable diagnostics.
- [ ] UI can show health/bootstrap status and repair actions.
- [-] No nested `.git` remains under `packages/*`.

## GitHub Operations Track

### Current

- [x] Issue templates and PR template in `.github/`.
- [x] CI pipeline with typecheck/build/test.
- [x] PR governance workflow for issue linking.
- [x] CODEOWNERS scaffold added.
- [x] Repo-management and onboarding docs added.

### Next

- [ ] Configure branch protection rules in GitHub settings.
- [ ] Create and apply label baseline in GitHub.
- [ ] Move `packages/ui` from nested repo to monorepo tracking.
- [ ] Validate release branch and tagging flow.

## Risk Log

Track risks as GitHub issues using the `Risk log` template.

### Required fields
- Owner
- Impact
- Likelihood
- Description
- Mitigation
- Status
