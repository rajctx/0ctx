# 0ctx

0ctx is a local-first context engine for AI workflows. It stores decisions, goals, constraints, assumptions, and artifacts in a persistent graph so context does not get lost when switching tools.

## Why this exists

- Most AI workflows lose context between sessions and tools.
- 0ctx provides one durable context graph per workspace/domain.
- MCP tools expose this graph to IDE assistants and chat clients.

## Packages

- `@0ctx/core`: Graph model, SQLite schema/migrations, query logic.
- `@0ctx/daemon`: Local socket service that owns graph state.
- `@0ctx/mcp`: MCP server that bridges tools to the daemon.
- `@0ctx/cli`: Product CLI (`0ctx`) for setup/install/bootstrap/doctor/repair.
- `@0ctx/ui`: Hosted UI codebase (contributor/dev surface, not packaged in end-user runtime).

## Installation Models

Enterprise packaged install (target no-clone path on npm):

```bash
npm install -g @0ctx/cli
0ctx setup --clients=all
0ctx doctor --json
```

Monorepo development/install (current reliable source workflow):

```bash
npm install
npm run build
npm run cli -- setup --clients=all --no-open
```

## Quick Commands

```bash
# Canonical first-run
0ctx setup --clients=all

# Daemon health and capability status
0ctx status

# CLI version
0ctx version
0ctx --version

# Bootstrap MCP registrations for supported clients
0ctx bootstrap --clients=claude,cursor,windsurf,codex,antigravity
0ctx bootstrap --clients=all --json
0ctx bootstrap --clients=all --dry-run

# Open hosted dashboard URL
0ctx dashboard

# Open local logs UI (command activity, daemon audit, queue, connector state)
0ctx logs

# Check connector posture
0ctx connector status --json
0ctx connector status --json --require-bridge

# Register connector with cloud control plane (fails if cloud unreachable)
0ctx connector register --require-cloud
0ctx connector register --require-cloud --json
0ctx connector verify --require-cloud --json

# Get/set per-context sync policy
0ctx sync policy get --context-id=<contextId>
0ctx sync policy set full_sync --context-id=<contextId>

# Run connector control loop in foreground (service target mode)
0ctx connector run --interval-ms=30000

# (Dev) Run local reference control-plane APIs
npm run dev:control-plane

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

# Repair local install
0ctx repair --clients=all

# Setup summary for automation
0ctx setup --clients=all --json

# Enterprise setup with strict cloud posture and initial workspace
0ctx setup --clients=all --require-cloud --wait-cloud-ready --create-context="Default Workspace"

# Skip managed service/bootstrap in constrained environments
0ctx setup --clients=all --skip-service --skip-bootstrap --no-open

# Pass onboarding metadata to hosted dashboard handoff
0ctx setup --clients=all --dashboard-query=source=cli
```

## Documentation

- `AGENTS.md`: implementation guidance and architecture.
- `docs/INDEX.md`: canonical docs entrypoint.
- `docs/ENV_REFERENCE.md`: canonical environment/config reference.
- `docs/SEMANTIC_BLACKBOARD_ARCHITECTURE.md`: hybrid blackboard runtime architecture.
- `docs/HYBRID_STORAGE_AND_SYNC_MODEL.md`: local/cloud storage contract and sync modes.
- `docs/CONNECTOR_SERVICE_ARCHITECTURE.md`: always-on local connector service design.
- `docs/INSTALL.md`: install and environment setup.
- `docs/QUICKSTART.md`: first-run workflow.
- `docs/RELEASE.md`: release checklist and tagging.
- `docs/ONBOARDING.md`: maintainer/contributor onboarding.

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
