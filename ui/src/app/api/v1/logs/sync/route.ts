/**
 * GET /api/v1/logs/sync?since={ms}&contextId={id}&limit={n}
 *
 * Returns a summary of sync envelopes stored for this tenant.
 * Groups by contextId and returns:
 *  - stats: total envelopes, unique contexts, encrypted count
 *  - contexts: one entry per contextId (latest metadata + count)
 *  - envelopes: individual envelope records (only if ?contextId= is specified)
 *
 * Note: payload is never returned (encrypted ciphertext / large blob).
 *       Only metadata + payload byte-size is exposed.
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
  const contextIdFilter = url.searchParams.get('contextId') ?? undefined;
  const rawLimit = Number(url.searchParams.get('limit') || '500');
  const fetchLimit = Math.min(500, Math.max(1, rawLimit));

  // Default: last 30 days. Caller can override with ?since=<unix-ms>
  const defaultSince = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const since = Number(url.searchParams.get('since') || defaultSince.toString());

  try {
    const store = getStore();
    const allEnvelopes = await store.getSyncEnvelopes(tenantId, since, fetchLimit);

    // ── Group by contextId ──────────────────────────────────────────────────
    interface ContextSummary {
      contextId: string;
      envelopeCount: number;
      latestTimestamp: number;
      latestReceivedAt: number;
      encrypted: boolean;
      syncPolicy: string | undefined;
      userId: string;
    }

    const contextMap = new Map<string, ContextSummary>();

    for (const e of allEnvelopes) {
      const existing = contextMap.get(e.contextId);
      if (!existing) {
        contextMap.set(e.contextId, {
          contextId: e.contextId,
          envelopeCount: 1,
          latestTimestamp: e.timestamp,
          latestReceivedAt: e.receivedAt,
          encrypted: e.encrypted,
          syncPolicy: e.syncPolicy,
          userId: e.userId,
        });
      } else {
        existing.envelopeCount++;
        if (e.timestamp > existing.latestTimestamp) {
          existing.latestTimestamp = e.timestamp;
          existing.latestReceivedAt = e.receivedAt;
          existing.encrypted = e.encrypted;
          existing.syncPolicy = e.syncPolicy;
          existing.userId = e.userId;
        }
      }
    }

    // Sort by latest sync desc
    const contexts = [...contextMap.values()].sort(
      (a, b) => b.latestTimestamp - a.latestTimestamp
    );

    const encryptedCount = allEnvelopes.filter(e => e.encrypted).length;
    const timestamps = allEnvelopes.map(e => e.timestamp);

    const stats = {
      totalEnvelopes: allEnvelopes.length,
      uniqueContexts: contextMap.size,
      encryptedCount,
      plainCount: allEnvelopes.length - encryptedCount,
      oldestTimestamp: timestamps.length > 0 ? Math.min(...timestamps) : null,
      newestTimestamp: timestamps.length > 0 ? Math.max(...timestamps) : null,
      windowDays: 30,
    };

    // ── Per-context envelope list (only when contextId filter is set) ────────
    let envelopes: object[] | undefined;
    if (contextIdFilter) {
      envelopes = allEnvelopes
        .filter(e => e.contextId === contextIdFilter)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 50)
        .map(e => ({
          id: e.id,
          contextId: e.contextId,
          userId: e.userId,
          timestamp: e.timestamp,
          receivedAt: e.receivedAt,
          encrypted: e.encrypted,
          syncPolicy: e.syncPolicy ?? null,
          // Never expose payload — it's encrypted ciphertext or a large blob.
          // Expose byte-size so UI can show "N bytes" without leaking content.
          payloadBytes: JSON.stringify(e.payload).length,
        }));
    }

    return jsonResponse({ stats, contexts, ...(envelopes !== undefined ? { envelopes } : {}) });
  } catch (err) {
    console.error('[logs/sync]', err);
    return errorResponse(500, 'store_error', 'Failed to fetch sync data.', true);
  }
}
