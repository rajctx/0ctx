---
name: 0ctx-enterprise-hardening
description: Implement and iterate enterprise-grade controls in 0ctx (audit logging, session correctness, observability, encrypted backups, reliability gates). Use when users request hardening from POC to production, compliance-readiness improvements, or operational robustness work.
---

# 0ctx Enterprise Hardening

Use this skill to execute high-confidence hardening work in the existing architecture.

## Scope Priorities

1. Correctness first:
- Session-aware context behavior across short-lived MCP socket requests.
- Explicit context isolation.

2. Control plane second:
- Audit trail for mutating operations.
- Health and metrics endpoints.
- Backup/restore with encryption.

3. Release safety third:
- Tests, CI gates, and migration safety.

## Repository Touchpoints

- `packages/core/src/db.ts`
- `packages/core/src/graph.ts`
- `packages/core/src/schema.ts`
- `packages/core/src/encryption.ts`
- `packages/daemon/src/handlers.ts`
- `packages/daemon/src/server.ts`
- `packages/daemon/src/metrics.ts`
- `packages/daemon/src/logger.ts`
- `packages/daemon/src/backup.ts`
- `packages/mcp/src/tools.ts`
- `packages/mcp/src/index.ts`

## Execution Pattern

1. Inspect current behavior.
2. Implement one hardening slice end-to-end.
3. Add/extend tests for the same slice.
4. Run gates before moving to next slice.

## Required Gates

```bash
npm run typecheck
npm run build
npm run test
```

## Done Criteria

- No regression in existing MCP graph workflows.
- New control surface is observable through MCP/daemon endpoints.
- Tests cover positive and failure paths.
- Migrations are versioned and backward-safe.
