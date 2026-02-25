# Release Guide

Updated: 2026-02-24

## Current automation state

- GitHub workflows are enabled under `.github/workflows/`.
- CI runs automatically on push/PR (OS matrix: ubuntu, windows, macos).
- PR governance enforces issue linkage.
- Release can be triggered via manual dispatch or tag push.
- For workflow management details, see `docs/GITHUB_ENABLEMENT_RUNBOOK.md`.

## Dry-run-first release sequence

Preferred single-command CLI flow:

```powershell
# Dry run (recommended first)
0ctx release publish --version vX.Y.Z --dry-run

# Publish to npm latest dist-tag
0ctx release publish --version vX.Y.Z

# Publish to npm next dist-tag (pre-release channels)
0ctx release publish --version vX.Y.Z --tag next

# Publish with 2FA OTP
0ctx release publish --version vX.Y.Z --otp 123456
```

The CLI flow runs release validation, changelog prep, tag preview, pack dry-run, and deterministic publish order (`core -> daemon -> mcp -> cli`).

Manual script sequence (full control):

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

# Alternate dist-tag (for pre-release channel)
powershell -ExecutionPolicy Bypass -File scripts/release/publish-packages.ps1 -Tag next
```

The script enforces the correct publish order and verifies version consistency across packages before publishing.

## Required release checks

- No open `release-blocker` issues.
- `CHANGELOG.md` contains a dated section for the target tag.
- Docs are updated for user-facing behavior changes.
- Migration notes are included for schema or protocol changes.

## GitHub Actions release paths

### Tag-triggered (preferred)

Push a tag to trigger the automated release pipeline:

```powershell
git tag -a vX.Y.Z -m "release: vX.Y.Z"
git push origin vX.Y.Z
```

The `Release (Tag)` workflow runs full CI, publishes all packages to npm (`@latest`), creates a GitHub Release with tarball checksums, and sends a webhook notification if configured.

### Manual dispatch

Go to **Actions > Release Manual** and fill in:
- `version`: tag name (e.g. `v1.2.3`)
- `dry_run`: set to `true` for validation-only run (no publish, no tag push)
- `npm_tag`: `latest` or `next` (for pre-release channels)

The workflow runs full CI, validates publish tarballs, then (if not dry-run) publishes packages, creates the tag, creates a GitHub Release with artifacts, and sends a webhook notification.

### Required secrets

- `NPM_TOKEN`: npm automation token with publish access to `@0ctx` scope.
- `RELEASE_WEBHOOK_URL` (optional): POST endpoint for release notifications.

## Rollback

1. Mark release as revoked in release notes.
2. Revert offending commit(s) on `main`.
3. Cut `hotfix/<name>` from `main`.
4. Tag patched release as `vX.Y.(Z+1)`.
