# GitHub Repo Management Guide

Canonical enterprise roadmap and tracker:

- `docs/ENTERPRISE_ROADMAP_AND_TRACKER.md`

## Repository model

Use one monorepo root for all packages under `packages/*`.

`packages/ui` should be managed as part of this root repository, not as a standalone nested git repo.

## Nested `packages/ui` migration policy

Use scripted migration to avoid accidental history loss:

```bash
npm run repo:check-nested-git
npm run repo:adopt-ui:dry
npm run repo:adopt-ui
```

What this does:

1. Detects nested `.git` directories.
2. Creates a backup bundle of `packages/ui` history.
3. Removes `packages/ui/.git` only in apply mode.
4. Leaves staged commit decision to maintainer.

After apply:

```bash
git add packages/ui
git commit -m "chore(repo): adopt packages/ui into monorepo"
```

## Branch protection baseline

Protect `main` with:

1. Required status checks:
   - `CI / build-and-test`
   - `PR Governance / check-pr-metadata`
2. Required pull request reviews:
   - At least 1 approval (2 for protocol/schema touching PRs)
3. Require CODEOWNERS review for owned paths.
4. Dismiss stale approvals on new commits.
5. Block force pushes and branch deletions.

Implementation checklist:

- `docs/GITHUB_SETTINGS_CHECKLIST.md`
- `docs/GITHUB_ENABLEMENT_RUNBOOK.md` (for workflow re-enable sequencing)

## Required labels

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

## Project board setup

Recommended columns:

1. Backlog
2. Ready
3. In Progress
4. Review
5. Blocked
6. Done

## Release governance

1. Merge completed work into `main`.
2. Cut `release/vX.Y` branch every two weeks.
3. Ensure no `release-blocker` issues remain open.
4. Run release checklist in `docs/RELEASE.md`.
5. Tag `vX.Y.Z` and publish release notes.

## Minimum maintainer cadence

- Weekly triage:
  - close stale `status/needs-info`
  - validate `priority/high`
- Weekly quality gate:
  - verify branch protection still enforced
  - verify CI is green on `main`
- Biweekly:
  - run release checklist and update `CHANGELOG.md`
