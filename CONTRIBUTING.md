# Contributing to 0ctx

Thanks for contributing. External pull requests are welcome.

## Scope

The main open-source support surface is the repo-first CLI/runtime workflow.

- `@0ctx/cli` and the local runtime are the primary review targets.
- `desktop-app/`, `ui/`, and `cloud/` are public but maintained on a best-effort basis.
- Security issues should follow `SECURITY.md` instead of public issue flow.

## Workflow

- `main` is the protected integration branch.
- Fork the repository and open pull requests from your fork unless you already
  have direct write access.
- Use short topic branches such as `feature/<short-name>`, `fix/<short-name>`,
  or `docs/<short-name>`.

## Pull Requests

1. Keep PRs focused and scoped to one subsystem where possible.
2. Link issues using `Closes #<id>` / `Refs #<id>`.
3. Run the expected checks locally before opening a PR:

```bash
npm run typecheck
npm run build
npm run test
npm run repo:check-nested-git
```

4. For protocol or schema changes, include migration and compatibility notes.
5. Update docs when user-facing behavior, support posture, or release steps change.
6. Maintainers may ask for narrower scope, additional tests, or follow-up cleanup
   before merge.

## Review Expectations

- Prefer small diffs over broad refactors.
- Add tests for behavior changes whenever practical.
- Preserve existing CLI, daemon, and MCP public behavior unless the change is intentional and documented.
- Avoid introducing new telemetry, hosted dependencies, or network defaults without explicit justification.

## Release Notes And Breaking Changes

- Mention user-visible changes in the PR summary.
- Call out migration steps, compatibility impact, or new environment variables.
- If a change affects packaging, run `npm run release:pack:verify`.

## Nested Repository Policy

`ui/` should be managed as part of this monorepo unless an explicit
submodule/subtree strategy is adopted.

- Do not initialize nested git repos under `packages/*` without documenting the decision.
- If nested history exists, migrate via subtree/submodule with documented steps.

Recommended migration tooling:

```bash
npm run repo:adopt-ui:dry
npm run repo:adopt-ui
```
