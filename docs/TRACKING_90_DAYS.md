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
- [x] Daemon recovery and restart robustness.

### Acceptance
- [x] Health and metrics endpoints reliable.
- [x] Structured logs contain request/session trace fields.
- [x] Failure scenarios have deterministic recovery behavior.

## Sprint 3 (Days 61-90): Product Surface (CLI/MCP/UI)

### Epic
- Improve end-user activation and daily workflows.

### Issues
- [x] CLI install/bootstrap/doctor/status/repair baseline.
- [x] MCP bootstrap compatibility matrix update.
- [x] UI install/status/repair wizard integration.
- [x] UI enterprise operations panel for diagnostics/audit/backups.
- [x] UI route split delivered for primary and operations workflows.
- [x] GitHub repo governance baseline (templates/docs/checks).
- [x] Nested `packages/ui` migration into monorepo tracking.
- [x] Release dry-run automation scripts for validation/changelog/tag preview.

### Acceptance
- [x] First-time setup under 5 minutes for supported clients.
- [x] `0ctx doctor` produces actionable diagnostics.
- [x] UI can show health/bootstrap status and repair actions.
- [x] No nested `.git` remains under `packages/*`.
- [x] Dry-run-first local release prep flow is documented and executable.

## GitHub Operations Track

### Current

- [x] Issue templates and PR template in `.github/`.
- [x] CI pipeline with typecheck/build/test.
- [x] PR governance workflow for issue linking.
- [x] CODEOWNERS scaffold added.
- [x] Repo-management and onboarding docs added.
- [x] `packages/ui` is governed under the monorepo root.
- [-] Release automation phase 1 complete; GitHub settings/workflow rollout pending.

### Next

- [ ] Configure branch protection rules in GitHub settings.
- [ ] Create and apply label baseline in GitHub.
- [ ] Re-enable workflows from `.github/workflows-disabled/` after approval.
- [ ] Validate release branch/tag flow with GitHub release publication.

## Risk Log

Track risks as GitHub issues using the `Risk log` template.

### Required fields
- Owner
- Impact
- Likelihood
- Description
- Mitigation
- Status
