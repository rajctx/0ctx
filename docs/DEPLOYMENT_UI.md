# Hosted UI Deployment Runbook

Updated: 2026-02-24  
Owner: UI Platform + SRE

## Deployment Model

- Platform: Vercel
- Topology: Next.js App Router + BFF routes (`/api/v1/*`)
- Environment strategy: production-only
- Runtime dependency: cloud control plane APIs + Auth0

## Production Deployment Steps

1. Validate locally:
- `npm run build --workspace=@0ctx/ui`
- `npm run test`

2. Validate docs/contracts:
- ensure `docs/UI_BFF_API_CONTRACT.md` and `docs/ENVIRONMENT_VARIABLES.md` match current code.

3. Deploy:
- trigger production deployment from protected branch.

4. Post-deploy checks:
- `/` loads
- `/login` loads
- `/dashboard` redirects or loads according to auth
- `/api/v1/runtime/status` returns expected posture payload

## Release Gates (Prod-only)

- required status checks must pass (typecheck/build/tests).
- manual reviewer gate required for production deployment.
- release freeze windows may be applied for high-risk periods.

## Rollback

1. Identify last known healthy deployment.
2. Roll back production deployment in Vercel.
3. Re-run smoke checks on `/`, `/dashboard`, `/api/v1/runtime/status`.
4. Open incident record with timeline and root cause path.

## Smoke Test Checklist

- Auth route health:
  - `/auth/login` and `/auth/logout` functional.
- BFF health:
  - runtime status endpoint returns JSON envelope.
- Dashboard route health:
  - workspace and operations routes render.
- Capability gating:
  - integrations actions disable with clear reason when bridge is degraded.

## Operational Ownership

See `docs/OPS_SLO_AND_OBSERVABILITY.md` for canonical on-call ownership, SLO targets, and incident model.
