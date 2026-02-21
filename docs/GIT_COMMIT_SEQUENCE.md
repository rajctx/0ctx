# Suggested Commit Sequence

Use this sequence to keep PR review manageable.

## Commit 1: Core enterprise hardening

Include:

- `packages/core/*`
- `packages/daemon/*`
- `packages/mcp/*`
- `vitest.config.ts`
- tests under `packages/core/test`, `packages/daemon/test`, `packages/mcp/test`

Message:

`feat(platform): add enterprise protocol, audit, backup, metrics hardening`

## Commit 2: Product CLI and install/bootstrap flow

Include:

- `packages/cli/*`
- root script updates in `package.json` and lockfile

Message:

`feat(cli): add install/bootstrap/doctor/repair workflows`

## Commit 3: Repo governance and GitHub operations

Include:

- `.github/*`
- `scripts/repo/*`
- `AGENTS.md`
- `CONTRIBUTING.md`
- `README.md`
- `docs/*`
- `CHANGELOG.md`
- `.gitignore`

Message:

`chore(repo): add governance, release, and GitHub management automation`

## Commit 4: Adopt UI package into monorepo

Include:

- removal of gitlink entry for `packages/ui`
- added tracked files under `packages/ui/*`

Message:

`chore(repo): adopt packages/ui into monorepo tracking`

## Pre-push checks

```bash
npm run typecheck
npm run test
npm run repo:check-nested-git
```
