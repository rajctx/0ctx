'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import {
  BackupManifestEntry,
  createBackupAction,
  listBackupsAction,
  restoreBackupAction
} from '@/app/actions';
import { useDashboardState } from '@/components/dashboard/dashboard-state-provider';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { formatTimestamp } from '@/lib/ui';

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DashboardBackupsPage() {
  const { activeContextId, refreshDashboardData, selectedMachineId } = useDashboardState();

  const [backups, setBackups] = useState<BackupManifestEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [backupName, setBackupName] = useState('');
  const [restoreName, setRestoreName] = useState('');
  const [encryptBackup, setEncryptBackup] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshBackups = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listBackupsAction(selectedMachineId);
      setBackups(next);
    } finally {
      setLoading(false);
    }
  }, [selectedMachineId]);

  useEffect(() => {
    void refreshBackups();
  }, [refreshBackups]);

  return (
    <div className="space-y-4 p-3 md:p-4">
      <Panel className="space-y-2 p-3">
        <p className="text-[11px] uppercase tracking-[0.13em] text-[var(--text-muted)]">Create Backup</p>
        <input
          value={backupName}
          onChange={event => setBackupName(event.target.value)}
          placeholder="Optional backup name"
          className="h-9 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus-ring)]"
        />
        <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={encryptBackup}
            onChange={event => setEncryptBackup(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-[var(--border-strong)] bg-transparent"
          />
          Encrypt backup payload
        </label>
        <Button
          variant="primary"
          size="sm"
          disabled={!activeContextId || !selectedMachineId || busyKey === 'create'}
          onClick={async () => {
            if (!activeContextId || !selectedMachineId) return;
            setBusyKey('create');
            setMessage(null);
            try {
              const backup = await createBackupAction(activeContextId, {
                name: backupName.trim() || undefined,
                encrypted: encryptBackup
              }, selectedMachineId);
              if (!backup) {
                setMessage('Backup creation failed.');
                return;
              }
              setMessage(`Backup created: ${backup.fileName}`);
              setBackupName('');
              await refreshBackups();
            } finally {
              setBusyKey(null);
            }
          }}
        >
          {busyKey === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Create backup
        </Button>
      </Panel>

      {message && (
        <div className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          {message}
        </div>
      )}
      {!selectedMachineId && (
        <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger-fg)]">
          Select an active machine to create or restore backups.
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-[0.13em] text-[var(--text-muted)]">Backup Inventory</p>
        <Button variant="secondary" size="sm" onClick={refreshBackups} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      <input
        value={restoreName}
        onChange={event => setRestoreName(event.target.value)}
        placeholder="Optional restored context name"
        className="h-9 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus-ring)]"
      />

      <div className="space-y-1.5">
        {backups.length === 0 ? (
          <Panel className="px-3 py-2 text-xs text-[var(--text-muted)]">No backups found.</Panel>
        ) : (
          backups.map(backup => {
            const restoreKey = `restore:${backup.fileName}`;
            const restoring = busyKey === restoreKey;
            return (
              <Panel key={backup.fileName} className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">{backup.fileName}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {formatBytes(backup.sizeBytes)} | {backup.encrypted ? 'Encrypted' : 'Plaintext'} |{' '}
                      {formatTimestamp(backup.createdAt)}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busyKey !== null || !selectedMachineId}
                    onClick={async () => {
                      const confirmRestore = window.confirm(
                        `Restore backup "${backup.fileName}" as a new context?`
                      );
                      if (!confirmRestore) return;
                      setBusyKey(restoreKey);
                      setMessage(null);
                      try {
                        const restored = await restoreBackupAction(backup.fileName, {
                          name: restoreName.trim() || undefined
                        }, selectedMachineId);
                        if (!restored) {
                          setMessage(`Failed to restore ${backup.fileName}.`);
                          return;
                        }
                        setMessage(`Restored backup into context "${restored.name}".`);
                        await refreshDashboardData();
                        await refreshBackups();
                      } finally {
                        setBusyKey(null);
                      }
                    }}
                  >
                    {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    Restore
                  </Button>
                </div>
              </Panel>
            );
          })
        )}
      </div>
    </div>
  );
}
