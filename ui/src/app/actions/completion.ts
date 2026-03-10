'use server';

import { bffPost } from '@/lib/bff-client';
import type { CompletionEvaluation } from '@/app/actions/types';

export async function evaluateCompletionAction(contextId: string, options: { cooldownMs?: number; requiredGates?: string[]; machineId?: string | null } = {}): Promise<CompletionEvaluation | null> {
  if (!contextId) return null;
  const res = await bffPost<CompletionEvaluation>('/api/v1/runtime/command', {
    method: 'evaluateCompletion',
    contextId,
    cooldownMs: options.cooldownMs,
    requiredGates: options.requiredGates,
    machineId: options.machineId ?? undefined,
  });
  return res.data ?? null;
}
