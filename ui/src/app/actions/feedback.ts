'use server';

import { bffPost } from '@/lib/bff-client';
import type { RecallFeedbackSummary } from '@/app/actions/types';

export async function listRecallFeedbackAction(options: { contextId?: string | null; nodeId?: string | null; helpful?: boolean; limit?: number; machineId?: string | null } = {}): Promise<RecallFeedbackSummary | null> {
  const payload: Record<string, unknown> = { method: 'listRecallFeedback', limit: options.limit ?? 50 };
  if (options.contextId) payload.contextId = options.contextId;
  if (options.nodeId) payload.nodeId = options.nodeId;
  if (typeof options.helpful === 'boolean') payload.helpful = options.helpful;
  if (options.machineId) payload.machineId = options.machineId;
  const res = await bffPost<RecallFeedbackSummary>('/api/v1/runtime/command', payload);
  if (!res.ok || !res.data) return null;

  return {
    contextId: res.data.contextId ?? null,
    total: Number(res.data.total ?? 0),
    helpfulCount: Number(res.data.helpfulCount ?? 0),
    notHelpfulCount: Number(res.data.notHelpfulCount ?? 0),
    nodeSummary: Array.isArray(res.data.nodeSummary) ? res.data.nodeSummary : [],
    items: Array.isArray(res.data.items) ? res.data.items : [],
  };
}

export async function submitRecallFeedbackAction(input: { nodeId: string; helpful: boolean; reason?: string; contextId?: string | null; machineId?: string | null }): Promise<{ ok: boolean } | null> {
  if (!input.nodeId.trim()) return null;
  const payload: Record<string, unknown> = { method: 'recallFeedback', nodeId: input.nodeId.trim(), helpful: input.helpful };
  if (input.contextId) payload.contextId = input.contextId;
  if (input.machineId) payload.machineId = input.machineId;
  const reason = input.reason?.trim();
  if (reason) payload.reason = reason;

  const res = await bffPost<{ ok?: boolean }>('/api/v1/runtime/command', payload);
  return res.ok ? { ok: Boolean(res.data?.ok) } : null;
}
