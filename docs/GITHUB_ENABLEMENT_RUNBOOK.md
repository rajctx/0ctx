# GitHub Enablement Runbook

## Purpose

Use this runbook only when maintainers explicitly approve re-enabling GitHub workflows.

Current state (2026-02-21): workflow files are intentionally parked in `.github/workflows-disabled/`.

## Preconditions

- Confirm branch protection and label rollout plan in `docs/GITHUB_SETTINGS_CHECKLIST.md`.
- Confirm CODEOWNERS placeholders are replaced with real users or teams.
- Confirm release/governance docs are up to date (`docs/RELEASE.md`, `CHANGELOG.md`).
- Confirm `gh` CLI authentication is valid for repo admin operations.

## Step 1: Dry-run GitHub settings bootstrap

```powershell
npm run repo:github:bootstrap:dry -- -Owner <owner> -Repo <repo>
```

Review label and branch protection output before applying.

## Step 2: Apply GitHub settings

```powershell
powershell -ExecutionPolicy Bypass -File scripts/repo/bootstrap-github.ps1 -Owner <owner> -Repo <repo>
```

If CODEOWNERS is fully configured:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/repo/bootstrap-github.ps1 -Owner <owner> -Repo <repo> -EnableCodeOwnerReviews
```

## Step 3: Re-enable workflows from parked directory

```powershell
New-Item -ItemType Directory -Path .github/workflows -Force | Out-Null
Get-ChildItem -LiteralPath .github/workflows-disabled -Filter *.yml | ForEach-Object {
    git mv $_.FullName (Join-Path ".github/workflows" $_.Name)
}
```

Commit and push the workflow enablement change on a pull request.

## Step 4: Verify expected checks and flows

- Open a PR and confirm required checks run:
  - `CI / build-and-test`
  - `PR Governance / check-pr-metadata`
- Confirm governance behavior by testing PR metadata rules.
- Confirm release flow readiness with `docs/RELEASE.md`.

## Rollback (if enablement fails)

```powershell
New-Item -ItemType Directory -Path .github/workflows-disabled -Force | Out-Null
Get-ChildItem -LiteralPath .github/workflows -Filter *.yml | ForEach-Object {
    git mv $_.FullName (Join-Path ".github/workflows-disabled" $_.Name)
}
```

Push rollback commit and keep workflows disabled until issues are resolved.
