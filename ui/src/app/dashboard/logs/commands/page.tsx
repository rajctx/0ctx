'use client';

import { useState, useEffect } from 'react';
import { StatusBadge } from '@/components/logs/status-badge';
import { DetailPanel } from '@/components/logs/detail-panel';
import { fmtAgo } from '@/lib/log-format';

interface CommandRow {
  commandId: string;
  machineId: string;
  method: string;
  status: 'pending' | 'applied' | 'failed';
  params: Record<string, unknown>;
  createdAt: number;
  cursor: number;
  contextId: string | null;
  error?: string;
}
type StatusFilter = 'all' | 'pending' | 'applied' | 'failed';

export default function CommandsPage() {
  const [commands, setCommands] = useState<CommandRow[]>([]);
  const [counts, setCounts] = useState({ pending: 0, applied: 0, failed: 0 });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<CommandRow | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const url = statusFilter === 'all' ? '/api/v1/logs/commands?limit=150' : `/api/v1/logs/commands?status=${statusFilter}&limit=150`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json() as { commands: CommandRow[]; counts: typeof counts };
    setCommands(data.commands);
    // Always fetch overall counts (unfiltered)
    const totals = await fetch('/api/v1/logs/commands?limit=500');
    if (totals.ok) {
      const td = await totals.json() as { counts: typeof counts };
      setCounts(td.counts);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [statusFilter]);
  useEffect(() => {
    const iv = setInterval(() => load(), 15000);
    return () => clearInterval(iv);
  }, [statusFilter]);

  const visible = statusFilter === 'all' ? commands : commands.filter(c => c.status === statusFilter);

  return (
    <div>
      <div className="l-toolbar">
        <div className="l-stats-bar" style={{ marginBottom: 0 }}>
          <span>PENDING: <b className="l-stat-val">{counts.pending}</b></span>
          <span>APPLIED: <b className="l-stat-val green">{counts.applied}</b></span>
          <span>FAILED:  <b className="l-stat-val red">{counts.failed}</b></span>
        </div>
        <div style={{ flex: 1 }} />
        {(['all', 'pending', 'applied', 'failed'] as StatusFilter[]).map(s => (
          <button
            key={s}
            className={`l-btn${statusFilter === s ? ' active' : ''}`}
            onClick={() => setStatusFilter(s)}
          >
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="l-empty">Loading commands...<span className="l-cursor" /></div>
      ) : visible.length === 0 ? (
        <div className="l-empty">
          No commands {statusFilter !== 'all' ? `with status "${statusFilter}"` : ''} found.
        </div>
      ) : (
        <table className="l-table">
          <thead>
            <tr>
              <th style={{ width: 8 }} />
              <th>ID</th>
              <th>TARGET</th>
              <th>METHOD</th>
              <th>STATUS</th>
              <th>PARAMS</th>
              <th>AGE</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(cmd => (
              <tr
                key={cmd.commandId}
                className={`t-${cmd.status}${selected?.commandId === cmd.commandId ? ' row-selected' : ''}`}
                onClick={() => setSelected(cmd)}
              >
                <td />
                <td className="l-dim" style={{ fontSize: 11 }}>{cmd.cursor}</td>
                <td>{cmd.machineId}</td>
                <td>{cmd.method}</td>
                <td><StatusBadge variant={cmd.status} /></td>
                <td className="l-dim" style={{ fontSize: 11 }}>
                  {JSON.stringify(cmd.params).slice(0, 50)}
                </td>
                <td className="l-dim">{fmtAgo(cmd.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DetailPanel
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.method ?? '--'}
        subtitle={selected ? `${selected.machineId} · cursor=${selected.cursor}` : undefined}
        accentColor={selected?.status === 'applied' ? 'var(--l-green)' : selected?.status === 'failed' ? 'var(--l-red)' : 'var(--l-gray)'}
        metadata={selected ? [
          { label: 'Command ID',  value: selected.commandId },
          { label: 'Machine ID',  value: selected.machineId },
          { label: 'Method',      value: selected.method },
          { label: 'Status',      value: selected.status },
          { label: 'Context ID',  value: selected.contextId ?? 'none' },
          { label: 'Created',     value: new Date(selected.createdAt).toISOString() },
          { label: 'Error',       value: selected.error ?? 'none' },
        ] : []}
        payload={selected ? JSON.stringify(selected.params, null, 2) : undefined}
      />
    </div>
  );
}
