# GitHub Settings Checklist

Use this checklist once per repository to enforce the workflow in this monorepo.

Current state:

- Workflow YAML files are currently parked in `.github/workflows-disabled/`.
- Re-enable flow is documented in `docs/GITHUB_ENABLEMENT_RUNBOOK.md`.

## 1) Branch protection (`main`)

GitHub path: `Settings -> Branches -> Add branch protection rule`

Recommended rule pattern:

- `main`

Enable:

1. Require a pull request before merging.
2. Require approvals: minimum 1 (use 2 for protocol/schema changes).
3. Dismiss stale pull request approvals when new commits are pushed.
4. Require status checks to pass before merging.
5. Require conversation resolution before merging.
6. Restrict who can push to matching branches.
7. Include administrators.
8. Do not allow force pushes.
9. Do not allow deletions.

## 2) Required status checks

In the same branch protection rule, require these exact checks:

1. `CI / build-and-test`
2. `PR Governance / check-pr-metadata`

Workflow sources:

- Current parked location: `.github/workflows-disabled/ci.yml`
- Current parked location: `.github/workflows-disabled/pr-governance.yml`
- Expected active location after enablement: `.github/workflows/*.yml`

## 3) CODEOWNERS enforcement

1. Replace placeholder owners in `.github/CODEOWNERS` with real GitHub users/teams.
2. Confirm each referenced owner exists in your org.
3. In branch protection, enable `Require review from Code Owners`.

Do not enable CODEOWNERS-required review until step 1 is complete.

## 4) Label baseline

Create/verify these labels:

- `type/feature`
- `type/bug`
- `type/docs`
- `type/chore`
- `priority/high`
- `priority/medium`
- `priority/low`
- `area/core`
- `area/daemon`
- `area/mcp`
- `area/cli`
- `area/ui`
- `status/needs-info`
- `status/in-progress`
- `status/review`
- `release-blocker`

## 5) Project board

Create GitHub Project `0ctx Delivery` (or equivalent) with:

1. Backlog
2. Ready
3. In Progress
4. Review
5. Blocked
6. Done

## 6) Release operation

Use workflow dispatch for release tags after workflows are re-enabled:

1. Open `Actions -> Release Manual`.
2. Run workflow with `version` like `v1.2.3`.
3. Verify validation steps pass.
4. Confirm tag and GitHub release are created.

Workflow source:

- Current parked location: `.github/workflows-disabled/release-manual.yml`
- Expected active location after enablement: `.github/workflows/release-manual.yml`

## 7) Smoke test policy

After enabling rules:

1. Open a test PR without issue link and confirm governance check fails.
2. Add `Closes #<id>` or `Refs #<id>` and confirm governance passes.
3. Confirm merge is blocked until required checks pass and approvals are present.

## Optional automation (GitHub CLI)

You can bootstrap labels + branch protection with:

```bash
npm run repo:github:bootstrap:dry -- -Owner <owner> -Repo <repo>
powershell -ExecutionPolicy Bypass -File scripts/repo/bootstrap-github.ps1 -Owner <owner> -Repo <repo>
```

If CODEOWNERS is fully configured, add:

```bash
powershell -ExecutionPolicy Bypass -File scripts/repo/bootstrap-github.ps1 -Owner <owner> -Repo <repo> -EnableCodeOwnerReviews
```
