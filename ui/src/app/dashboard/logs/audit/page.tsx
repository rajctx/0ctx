'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { DetailPanel } from '@/components/logs/detail-panel';
import { fmtTs, fmtAgo } from '@/lib/log-format';
import { useVisibleInterval } from '@/lib/use-visible-interval';

interface AuditEvent {
  id: string;
  timestamp: number;
  operation: string;
  status: 'success' | 'failure' | 'partial';
  contextId?: string;
  agentId?: string;
  toolName?: string;
  details?: Record<string, unknown>;
  error?: string;
}

type StatusFilter = 'all' | 'success' | 'failure' | 'partial';

function statusToVariant(status: string) {
  if (status === 'success') return 't-applied';
  if (status === 'failure') return 't-failed';
  if (status === 'partial') return 't-heartbeat';
  return 't-event';
}

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [counts, setCounts] = useState({ success: 0, failure: 0, partial: 0 });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [contextFilter, setContextFilter] = useState('');
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const contextFilterRef = useRef(contextFilter);
  contextFilterRef.current = contextFilter;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: '200' });
    const filter = contextFilterRef.current;
    if (filter) params.set('contextId', filter);

    const res = await fetch(`/api/v1/audit?${params}`);
    if (!res.ok) {
      if (res.status === 502) {
        setError('Daemon not reachable. Ensure the 0ctx daemon is running.');
      } else {
        setError(`Failed to load audit log (${res.status})`);
      }
      setLoading(false);
      return;
    }

    const data = await res.json() as { events?: AuditEvent[]; items?: AuditEvent[] };
    const items: AuditEvent[] = Array.isArray(data.events)
      ? data.events
      : Array.isArray(data.items)
        ? data.items
        : [];

    setEvents(items);
    setCounts({
      success: items.filter(e => e.status === 'success').length,
      failure: items.filter(e => e.status === 'failure').length,
      partial: items.filter(e => e.status === 'partial').length,
    });
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [contextFilter, load]);
  useVisibleInterval(load, 30_000);

  const visible = statusFilter === 'all'
    ? events
    : events.filter(e => e.status === statusFilter);

  return (
    <div>
      <div className="l-toolbar">
        <div className="l-stats-bar" style={{ marginBottom: 0 }}>
          <span>SUCCESS: <b className="l-stat-val green">{counts.success}</b></span>
          <span>PARTIAL: <b className="l-stat-val amber">{counts.partial}</b></span>
          <span>FAILURE: <b className="l-stat-val red">{counts.failure}</b></span>
        </div>
        <div style={{ flex: 1 }} />
        <input
          type="text"
          placeholder="FILTER CONTEXT ID..."
          value={contextFilter}
          onChange={e => setContextFilter(e.target.value)}
          className="l-filter-input"
          style={{ width: 180 }}
        />
        <div style={{ width: 12 }} />
        {(['all', 'success', 'partial', 'failure'] as StatusFilter[]).map(s => (
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
        <div className="l-empty">Loading audit log...<span className="l-cursor" /></div>
      ) : error ? (
        <div className="l-empty" style={{ color: 'var(--l-red)' }}>
          {error}
        </div>
      ) : visible.length === 0 ? (
        <div className="l-empty">
          No audit events{statusFilter !== 'all' ? ` with status "${statusFilter}"` : ''} found.
        </div>
      ) : (
        <table className="l-table">
          <thead>
            <tr>
              <th style={{ width: 8 }} />
              <th>TIME</th>
              <th>OPERATION</th>
              <th>STATUS</th>
              <th>CONTEXT</th>
              <th>TOOL</th>
              <th>AGE</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(ev => (
              <tr
                key={ev.id}
                className={`${statusToVariant(ev.status)}${selected?.id === ev.id ? ' row-selected' : ''}`}
                onClick={() => setSelected(ev)}
              >
                <td />
                <td className="l-dim">{fmtTs(ev.timestamp)}</td>
                <td>{ev.operation}</td>
                <td>
                  <span style={{
                    color: ev.status === 'success'
                      ? 'var(--l-green)'
                      : ev.status === 'failure'
                        ? 'var(--l-red)'
                        : 'var(--l-amber)',
                    fontWeight: 600,
                    fontSize: 11,
                  }}>
                    {ev.status.toUpperCase()}
                  </span>
                </td>
                <td className="l-dim" style={{ fontSize: 11 }}>{ev.contextId ?? '--'}</td>
                <td className="l-dim" style={{ fontSize: 11 }}>{ev.toolName ?? '--'}</td>
                <td className="l-dim">{fmtAgo(ev.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DetailPanel
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.operation ?? '--'}
        subtitle={selected ? `${new Date(selected.timestamp).toISOString()}` : undefined}
        accentColor={
          selected?.status === 'success'
            ? 'var(--l-green)'
            : selected?.status === 'failure'
              ? 'var(--l-red)'
              : 'var(--l-amber)'
        }
        metadata={selected ? [
          { label: 'Event ID',   value: selected.id },
          { label: 'Operation',  value: selected.operation },
          { label: 'Status',     value: selected.status },
          { label: 'Context ID', value: selected.contextId ?? 'none' },
          { label: 'Agent ID',   value: selected.agentId ?? 'none' },
          { label: 'Tool',       value: selected.toolName ?? 'none' },
          { label: 'Timestamp',  value: new Date(selected.timestamp).toISOString() },
          { label: 'Error',      value: selected.error ?? 'none' },
        ] : []}
        payload={selected?.details ? JSON.stringify(selected.details, null, 2) : undefined}
      />
    </div>
  );
}
