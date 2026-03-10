'use server';

import { bffGet, bffPost } from '@/lib/bff-client';
import type { BackupManifestEntry, RestoreBackupResult } from '@/app/actions/types';

export async function listBackupsAction(machineId?: string | null): Promise<BackupManifestEntry[]> {
  const params: Record<string, string> = {};
  if (machineId) params.machineId = machineId;
  const res = await bffGet<BackupManifestEntry[]>('/api/v1/backups', { params });
  return Array.isArray(res.data) ? res.data : [];
}

export async function createBackupAction(contextId: string, options: { name?: string; encrypted?: boolean } = {}, machineId?: string | null): Promise<BackupManifestEntry | null> {
  if (!contextId) return null;
  const res = await bffPost<BackupManifestEntry>('/api/v1/backups', { action: 'create', contextId, machineId: machineId ?? undefined, name: options.name, encrypted: options.encrypted ?? true });
  return res.data ?? null;
}

export async function restoreBackupAction(fileName: string, options: { name?: string } = {}, machineId?: string | null): Promise<RestoreBackupResult | null> {
  if (!fileName) return null;
  const res = await bffPost<RestoreBackupResult>('/api/v1/backups', { action: 'restore', fileName, machineId: machineId ?? undefined, name: options.name });
  return res.data ?? null;
}
