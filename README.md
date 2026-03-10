# 0ctx

0ctx is a local-first project memory runtime for AI workflows. It captures work by repo, keeps workstreams and checkpoints attached to the right project, and makes the same memory available to supported agents through the local runtime.

## Why this exists

- Most AI workflows lose context between sessions, tools, and branches.
- 0ctx keeps one durable workspace per repo and groups activity into workstreams, sessions, checkpoints, and reviewed insights.
- The daemon is the source of truth. Supported agents retrieve through the local runtime after `0ctx enable`.

## Packages

- `@0ctx/core`: Graph model, SQLite schema/migrations, query logic.
- `@0ctx/daemon`: Local socket service that owns graph state.
- `@0ctx/mcp`: MCP server that bridges tools to the daemon.
- `@0ctx/cli`: Product CLI (`0ctx`) for repo enablement, repair, bootstrap, and support workflows.
- `@0ctx/ui`: Hosted UI codebase (contributor/dev surface, not packaged in end-user runtime).

## Installation Models

Enterprise packaged install (target no-clone path on npm):

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
0ctx setup --no-open
0ctx doctor --json
0ctx repair

# Check connector posture
0ctx connector status --json
0ctx connector status --json --require-bridge

# Register connector with cloud control plane (fails if cloud unreachable)
0ctx connector register --require-cloud
0ctx connector register --require-cloud --json
0ctx connector verify --require-cloud --json

# Get/set per-context sync policy
0ctx sync policy get --repo-root=.
0ctx sync policy set metadata_only --repo-root=.
# Opt in to richer cloud sync explicitly
0ctx sync policy set full_sync --repo-root=.

# Run connector control loop in foreground (service target mode)
0ctx connector run --interval-ms=5000

# Install managed connector runtime service (preferred)
0ctx connector service install
0ctx connector service enable
0ctx connector service start

# Inspect/drain/purge connector event queue
0ctx connector queue status --json
0ctx connector queue drain --max-batches=10 --wait --strict --timeout-ms=120000
0ctx connector queue purge --older-than-hours=168 --dry-run
0ctx connector queue logs --limit=50
0ctx connector queue logs --clear --dry-run

# Workstream/session/checkpoint flows
0ctx workstreams --repo-root .
0ctx sessions --repo-root .
0ctx checkpoints --repo-root .

# Advanced cloud-backed machine setup
0ctx setup --require-cloud --wait-cloud-ready --create-context="Default Workspace"
```

## Supported path

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

## Documentation

- `AGENTS.md`: implementation guidance and architecture.
- `docs/INDEX.md`: temporary placeholder while the full docs set is being rewritten.
- CLI help and in-product setup flows are the current source of truth for usage details.

## Repository Policy

- Keep all packages in a single monorepo (`packages/*`).
- Do not keep nested git repositories inside packages.
- If `packages/ui` currently has its own `.git`, use:

```bash
npm run repo:adopt-ui:dry
npm run repo:adopt-ui
```

## License

See package-level licensing policy before publishing externally.
