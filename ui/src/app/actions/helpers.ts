import type { BffResponse } from '@/lib/bff-client';
import type { CliRunResult, SupportedClient } from '@/app/actions/types';
import { GA_SUPPORTED_CLIENTS, SUPPORTED_CLIENTS } from '@/app/actions/types';

export function bffToCliResult<T>(res: BffResponse<T>, label: string): CliRunResult & { payload: T | null } {
  const now = Date.now();
  return {
    ok: res.ok,
    command: 'bff',
    args: [label],
    exitCode: res.ok ? 0 : 1,
    stdout: res.ok ? JSON.stringify(res.data) : '',
    stderr: res.error?.message ?? '',
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    payload: res.data ?? null,
  };
}

export function normalizeClients(clients?: SupportedClient[]): SupportedClient[] {
  if (!clients || clients.length === 0) return [...GA_SUPPORTED_CLIENTS];
  const filtered = Array.from(new Set(clients)).filter((client): client is SupportedClient => SUPPORTED_CLIENTS.includes(client as SupportedClient));
  return filtered.length > 0 ? filtered : [...GA_SUPPORTED_CLIENTS];
}
