# Release Guide

## Current automation state

- GitHub workflows remain disabled under `.github/workflows-disabled/`.
- Do not re-enable workflows as part of standard release preparation.
- When enablement is approved later, follow `docs/GITHUB_ENABLEMENT_RUNBOOK.md`.

## Dry-run-first release sequence

Run this exact sequence from repository root:

```powershell
$version = "vX.Y.Z"
$releaseBranch = "release/vX.Y"

git checkout main
git pull --ff-only

npm run repo:check-nested-git
npm run release:validate -- -DryRun -AllowDirty
npm run release:changelog:prepare -- -Version $version -DryRun
npm run release:tag:dry -- -Version $version
```

If the dry-run phase is clean, execute the release prep:

```powershell
git checkout -b $releaseBranch

npm run release:validate
npm run release:changelog:prepare -- -Version $version
npm run release:tag:dry -- -Version $version
```

Finalize and publish:

```powershell
git add CHANGELOG.md
git commit -m "chore(release): prepare $version"
git tag -a $version -m "release: $version"
git push origin $releaseBranch
git push origin $version
```

Validate the publish tarball contents (no registry writes):

```powershell
npm run release:publish:dry
```

Publish all packages in deterministic order (`core → daemon → mcp → cli`):

```powershell
# Without 2FA
npm run release:publish

# With 2FA (OTP from authenticator app)
powershell -ExecutionPolicy Bypass -File scripts/release/publish-packages.ps1 -OTP 123456
```

The script enforces the correct publish order and verifies version consistency across packages before publishing.

## Required release checks

- No open `release-blocker` issues.
- `CHANGELOG.md` contains a dated section for the target tag.
- Docs are updated for user-facing behavior changes.
- Migration notes are included for schema or protocol changes.

## Rollback

1. Mark release as revoked in release notes.
2. Revert offending commit(s) on `main`.
3. Cut `hotfix/<name>` from `main`.
4. Tag patched release as `vX.Y.(Z+1)`.
