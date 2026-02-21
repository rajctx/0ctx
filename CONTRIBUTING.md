# Contributing to 0ctx

## Branching

- `main` is the protected integration branch.
- Use feature branches:
  - `feature/<short-name>`
  - `fix/<short-name>`
  - `hotfix/<short-name>`

## Pull Requests

1. Keep PRs focused and scoped to one subsystem where possible.
2. Link issues using `Closes #<id>` / `Refs #<id>`.
3. Run required checks locally before opening PR:

```bash
npm run typecheck
npm run build
npm run test
npm run repo:check-nested-git
```

4. For protocol/schema changes, include migration + compatibility notes.

## Labels (expected)

- Type: `type/feature`, `type/bug`, `type/docs`, `type/chore`
- Priority: `priority/high`, `priority/medium`, `priority/low`
- Area: `area/core`, `area/daemon`, `area/mcp`, `area/cli`, `area/ui`
- Status: `status/needs-info`, `status/in-progress`, `status/review`
- Release: `release-blocker`

## Release Cadence

- Default release cadence: every 2 weeks.
- Cut branch from `main` as `release/vX.Y`.
- Tag final release as `vX.Y.Z`.
- `release-blocker` issues must be closed before tagging.

## Nested Repository Policy

`packages/ui` should be managed as part of this monorepo unless an explicit submodule/subtree strategy is adopted.

- Do not initialize nested git repos under `packages/*` without documenting the decision.
- If nested history exists, migrate via subtree/submodule with documented steps.

Recommended migration tooling:

```bash
npm run repo:adopt-ui:dry
npm run repo:adopt-ui
```
