# Maintainer Onboarding

Updated: 2026-02-24

Primary planning/tracking source:

- `docs/ENTERPRISE_ROADMAP_AND_TRACKER.md`

## 1) Local setup

```bash
npm install
npm run build
npm run test
```

## 2) Understand package boundaries

- `packages/core`: graph model + persistence.
- `packages/daemon`: runtime/service boundary.
- `packages/mcp`: MCP adapter surface.
- `packages/cli`: product entrypoint for installation and diagnostics.
- `packages/ui`: hosted UI codebase (contributor/dev surface; not packaged in end-user CLI runtime).

## 3) Verify runtime

```bash
npm run cli -- status
npm run cli -- doctor --json
```

## 4) GitHub operating model

- Use branch naming:
  - `feature/<name>`
  - `fix/<name>`
  - `hotfix/<name>`
- Follow PR template and link issues.
- Use labels from `docs/GITHUB_REPO_MANAGEMENT.md`.
- Do not merge if required checks fail.
- Workflows are currently parked under `.github/workflows-disabled/`; use `docs/GITHUB_ENABLEMENT_RUNBOOK.md` when re-enable is approved.

## 5) Repo hygiene checks

```bash
npm run repo:check-nested-git
```

If nested `.git` is detected in a package:

```bash
npm run repo:adopt-ui:dry
npm run repo:adopt-ui
```

## 6) Release readiness

Use `docs/RELEASE.md` checklist before cutting `release/vX.Y`.

Key release scripts:

```bash
npm run release:validate       # typecheck + build + test + clean-tree check
npm run release:changelog:prepare -- -Version vX.Y.Z
npm run release:tag:dry -- -Version vX.Y.Z
npm run release:publish:dry    # pack dry-run all packages (no registry writes)
npm run release:publish        # publish core → daemon → mcp → cli
```
