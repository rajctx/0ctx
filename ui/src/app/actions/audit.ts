'use server';

import { bffGet } from '@/lib/bff-client';
import type { AuditEventEntry } from '@/app/actions/types';

export async function listAuditEventsAction(contextId?: string | null, limit = 50): Promise<AuditEventEntry[]> {
  const params: Record<string, string> = { limit: String(limit) };
  if (contextId) params.contextId = contextId;
  const res = await bffGet<AuditEventEntry[]>('/api/v1/audit', { params });
  return Array.isArray(res.data) ? res.data : [];
}
