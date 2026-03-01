/**
 * GET /api/v1/sync/pull?since={timestamp}
 *
 * Returns SyncEnvelopes stored for this tenant that are newer than `since` (unix ms).
 * The daemon calls this to receive context changes from other devices/users on the same tenant.
 *
 * Response shape matches what sync-transport.ts PullResult expects:
 *   { envelopes: SyncEnvelope[] }
 *
 * Security:
 *  - Requires valid Auth0 session
 *  - Returns ONLY envelopes belonging to the authenticated tenant (strict isolation)
 */

import { getStore } from '@/lib/store';
import { requireTenantSession, errorResponse, jsonResponse } from '@/lib/bff';

export async function GET(request: Request) {
  const [, claims, authErr] = await requireTenantSession();
  if (authErr) return authErr;

  const tenantId = claims.tenantId;
  if (!tenantId) {
    return errorResponse(403, 'no_tenant', 'No tenant associated with this account.');
  }

  const url = new URL(request.url);
  const since = Math.max(0, Number(url.searchParams.get('since') || '0'));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || '50')));

  try {
    const store = getStore();
    const stored = await store.getSyncEnvelopes(tenantId, since, limit);

    // Re-shape to the SyncEnvelope wire format the daemon expects
    const envelopes = stored.map(e => ({
      version: 1 as const,
      contextId: e.contextId,
      tenantId: e.tenantId,
      userId: e.userId,
      timestamp: e.timestamp,
      encrypted: e.encrypted,
      ...(e.syncPolicy ? { syncPolicy: e.syncPolicy } : {}),
      payload: e.payload,
    }));

    return jsonResponse({ envelopes });
  } catch (err) {
    console.error('[sync/pull]', err);
    return errorResponse(500, 'store_error', 'Failed to fetch sync envelopes.', true);
  }
}
