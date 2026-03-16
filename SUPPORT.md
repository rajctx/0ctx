# Support

## What To Use

- Use GitHub issues for bug reports, reproducible regressions, and feature requests.
- Use pull requests for concrete fixes or documentation updates.
- Use [SECURITY.md](./SECURITY.md) for vulnerabilities or sensitive reports.

## Support Boundaries

The primary open-source support surface is the local CLI/runtime flow:

- `@0ctx/cli`
- the local daemon/runtime
- the repo-first enablement and retrieval path

The following parts of the monorepo are public, but are maintained on a
best-effort basis unless explicitly documented otherwise:

- `desktop-app/`
- `ui/`
- `cloud/`
- private workspace packages under `packages/*`

## Before Opening an Issue

- Reproduce on the latest `main` branch or latest published CLI version when possible.
- Run `npm run typecheck`, `npm run build`, and `npm run test` for code changes.
- Include platform details, the command you ran, expected behavior, and actual behavior.

## Maintainer Expectations

- There is no guaranteed response time or SLA.
- Maintainers may close issues that are out of scope, unreproducible, or missing key information.
- External pull requests are welcome, but maintainers may request scope reductions or follow-up work before merging.
