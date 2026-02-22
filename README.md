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
- `@0ctx/cli`: Product CLI (`0ctx`) for install/bootstrap/doctor/repair.
- `@0ctx/ui`: Next.js app for graph visualization and edits.

## Installation Models

Enterprise packaged install (target no-clone path on npm):

```bash
npm install -g @0ctx/cli
0ctx install --clients=all
0ctx doctor --json
```

Monorepo development/install (current reliable source workflow):

```bash
npm install
npm run build
npm run cli -- install --clients=all
```

## Quick Commands

```bash
# Daemon health and capability status
0ctx status

# Bootstrap MCP registrations for supported clients
0ctx bootstrap --clients=claude,cursor,windsurf

# Repair local install
0ctx repair --clients=all
```

## Documentation

- `AGENTS.md`: implementation guidance and architecture.
- `docs/ENTERPRISE_ROADMAP_AND_TRACKER.md`: single source of truth for enterprise roadmap + execution tracker.
- `docs/INSTALL.md`: install and environment setup.
- `docs/QUICKSTART.md`: first-run workflow.
- `docs/GITHUB_REPO_MANAGEMENT.md`: repo governance and branch protection.
- `docs/GITHUB_ENABLEMENT_RUNBOOK.md`: workflow re-enable procedure and rollback.
- `docs/PLAN_STATUS.md`: completed/in-progress/planned status.
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
