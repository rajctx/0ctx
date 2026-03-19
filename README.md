# 0ctx

0ctx is a local-first project memory runtime for AI workflows. It captures work by repo, keeps workstreams and checkpoints attached to the right project, and makes the same memory available to supported agents through the local runtime.

`@0ctx/cli` is the primary open-source entrypoint. The daemon owns local state,
and the other surfaces in this monorepo build on top of the same runtime.

## Why this exists

- Most AI workflows lose context between sessions, tools, and branches.
- 0ctx keeps one durable workspace per repo and groups activity into workstreams, sessions, checkpoints, and reviewed insights.
- The daemon is the source of truth. Supported agents retrieve through the local runtime after `0ctx enable`.

## Repository Surfaces

- `@0ctx/cli`: Official installable OSS surface for repo enablement, repair,
  bootstrap, and support workflows.
- `packages/core`, `packages/daemon`, `packages/mcp`: Internal runtime packages
  that power the CLI and local daemon.
- `desktop-app/`: Contributor and dev-focused Electron management surface.
- `ui/`: Contributor and dev web surface for docs and install guidance.

## Open-Source Quickstart

Install the published CLI:

```bash
npm install -g @0ctx/cli
cd <repo>
0ctx enable
0ctx status
```

Monorepo development/install (current reliable source workflow):

```bash
npm install
npm run build
npm run cli:install-local
cd <repo>
0ctx enable
```

## Quick Commands

```bash
# Canonical repo-first enablement
cd <repo>
0ctx enable

# Optional: pick a product data policy during enable
0ctx enable --data-policy=review

# Daemon/runtime health
0ctx status

# CLI version
0ctx version
0ctx --version

# Repair automatic retrieval for supported agents (advanced)
0ctx bootstrap --clients=ga
0ctx bootstrap --clients=ga --json
0ctx bootstrap --clients=ga --dry-run

# Advanced machine workflow
0ctx setup
0ctx doctor --json
0ctx repair

# Workstream/session/checkpoint flows
0ctx workstreams --repo-root .
0ctx sessions --repo-root .
0ctx checkpoints --repo-root .
```

Capture hooks are part of the normal local product path via `0ctx hook ...`.
Older `0ctx connector hook ...` installs still work as compatibility aliases.

For monorepo development:

```bash
npm install
npm run build
npm run cli:install-local
cd <repo>
0ctx enable
```

## Supported OSS Path

GA integrations:

- Claude Code
- Factory / Droid
- Antigravity

Non-GA integrations stay outside the normal product path.
Only use them when you explicitly opt into them.

The normal product path is repo-first:

```bash
cd <repo>
0ctx enable
```

That binds the repo, starts or verifies the local runtime, installs supported capture integrations, and turns on automatic retrieval for supported agents.

The official open-source story is the repo-first CLI/runtime path:

```bash
cd <repo>
0ctx enable
```

That binds the repo, starts or verifies the local runtime, installs supported
capture integrations, and turns on automatic retrieval for supported agents.

`hook` commands are the supported capture-management surface for local installs.
Most users should not need anything beyond `0ctx enable` and `0ctx status`.

## Documentation

- `AGENTS.md`: implementation guidance and architecture.
- `docs/INDEX.md`: docs entrypoint.
- `docs/QUICKSTART.md`: repo-first product path.
- `docs/INTEGRATIONS.md`: GA vs preview integration model.
- `docs/DATA_POLICY.md`: local-first retention and debug defaults.
- `docs/RELEASE.md`: release validation and verification flow.

## Contributing And Support

- See `CONTRIBUTING.md` for fork/PR workflow and validation expectations.
- See `CODE_OF_CONDUCT.md` for repository participation standards.
- See `SECURITY.md` for vulnerability reporting.
- See `SUPPORT.md` for public support boundaries.

## Privacy Defaults

- A clean source build does not send CLI telemetry unless it is explicitly enabled and configured.
- UI surfaces do not initialize Sentry unless `NEXT_PUBLIC_SENTRY_DSN` is set.

## Repository Policy

- Keep all packages in a single monorepo (`packages/*`).
- Do not keep nested git repositories inside packages.
- If `ui/.git` currently exists as a nested repository, use:

```bash
npm run repo:adopt-ui:dry
npm run repo:adopt-ui
```

## License

Apache-2.0. See [LICENSE](./LICENSE).
