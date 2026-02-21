# Release Guide

## Branching and cadence

- `main` is the protected integration branch.
- Standard cadence: every 2 weeks.
- Cut `release/vX.Y` from `main`.
- Ship tag `vX.Y.Z`.

## Pre-release checklist

```bash
npm ci
npm run typecheck
npm run build
npm run test
npm run repo:check-nested-git
```

Required before tagging:

- No open `release-blocker` issues.
- Docs updated for user-facing behavior changes.
- Migration notes included for schema/protocol changes.

## Tag and publish flow

1. Update versions/changelog.
2. Create release branch `release/vX.Y`.
3. Run full validation checks.
4. Tag release commit: `git tag vX.Y.Z`.
5. Push branch and tag.
6. Publish package artifacts (internal/public registry policy).
7. Create GitHub release notes from merged PRs.

## Rollback

1. Mark release as revoked in GitHub release notes.
2. Revert offending commit(s) on `main`.
3. Cut hotfix branch `hotfix/<name>`.
4. Retag patched release as `vX.Y.(Z+1)`.
