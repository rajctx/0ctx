'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { DetailPanel } from '@/components/logs/detail-panel';
import { fmtAgo, fmtTs } from '@/lib/log-format';
import { useVisibleInterval } from '@/lib/use-visible-interval';

interface EventBatchRow {
  id: string;
  machineId: string;
  subscriptionId: string;
  cursor: number;
  receivedAt: number;
  eventCount: number;
  firstEventType: string;
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventBatchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [machineFilter, setMachineFilter] = useState('');
  const [selected, setSelected] = useState<EventBatchRow | null>(null);
  const [loading, setLoading] = useState(true);

  const sseActiveRef = useRef(false);
  const machineFilterRef = useRef(machineFilter);

  useEffect(() => {
    machineFilterRef.current = machineFilter;
  }, [machineFilter]);

  const load = useCallback(async () => {
    const filter = machineFilterRef.current;
    const url = filter
      ? `/api/v1/logs/events?limit=100&machineId=${encodeURIComponent(filter)}`
      : '/api/v1/logs/events?limit=100';
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json() as { events: EventBatchRow[]; total: number };
    setEvents(data.events);
    setTotal(data.total);
    setLoading(false);
  }, []);

  // Initial load on filter change
  useEffect(() => { load(); }, [machineFilter, load]);

  // SSE for real-time updates — replaces polling when available
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/v1/events/stream');
      es.addEventListener('open', () => { sseActiveRef.current = true; });
      es.addEventListener('message', () => load());
      es.addEventListener('error', () => { sseActiveRef.current = false; });
    } catch {
      sseActiveRef.current = false;
    }
    return () => {
      es?.close();
      sseActiveRef.current = false;
    };
  }, [load]);

  // Fallback polling — only fires when SSE is down, pauses when tab hidden
  useVisibleInterval(() => {
    if (!sseActiveRef.current) load();
  }, 15_000);

  // Deduplicate machineIds for the filter dropdown
  const machineIds = Array.from(new Set(events.map(e => e.machineId)));

  return (
    <div>
      <div className="l-toolbar">
        <div className="l-stats-bar" style={{ marginBottom: 0 }}>
          <span>BATCHES: <b className="l-stat-val">{total}</b></span>
          <span>EVENTS: <b className="l-stat-val green">{events.reduce((n, e) => n + e.eventCount, 0)}</b></span>
          <span>SOURCES: <b className="l-stat-val">{machineIds.length}</b></span>
        </div>
        <div style={{ flex: 1 }} />
        <select
          value={machineFilter}
          onChange={e => setMachineFilter(e.target.value)}
          className="l-filter-input"
          style={{ background: '#111', color: machineFilter ? 'var(--l-text)' : 'var(--l-text-dim)' }}
        >
          <option value="">ALL SOURCES</option>
          {machineIds.map(id => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="l-empty">Loading event stream...<span className="l-cursor" /></div>
      ) : events.length === 0 ? (
        <div className="l-empty">
          No event batches found.<br />
          Events are delivered by connectors once subscriptions are active.
        </div>
      ) : (
        <table className="l-table">
          <thead>
            <tr>
              <th style={{ width: 8 }} />
              <th>TIME</th>
              <th>SOURCE</th>
              <th>CURSOR</th>
              <th>EVENTS</th>
              <th>FIRST TYPE</th>
              <th>AGE</th>
            </tr>
          </thead>
          <tbody>
            {events.map(ev => (
              <tr
                key={ev.id}
                className={`t-event${selected?.id === ev.id ? ' row-selected' : ''}`}
                onClick={() => setSelected(ev)}
              >
                <td />
                <td className="l-dim">{fmtTs(ev.receivedAt)}</td>
                <td>{ev.machineId}</td>
                <td className="l-dim" style={{ fontSize: 11 }}>{ev.cursor}</td>
                <td>
                  <span style={{
                    color: ev.eventCount > 10 ? 'var(--l-amber)' : 'var(--l-green)',
                    fontWeight: 600,
                  }}>
                    {ev.eventCount}
                  </span>
                </td>
                <td className="l-dim" style={{ fontSize: 11 }}>{ev.firstEventType}</td>
                <td className="l-dim">{fmtAgo(ev.receivedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DetailPanel
        open={!!selected}
        onClose={() => setSelected(null)}
        title={`BATCH · ${selected?.eventCount ?? 0} events`}
        subtitle={selected ? `${selected.machineId} · cursor=${selected.cursor}` : undefined}
        accentColor="var(--l-accent-pink)"
        metadata={selected ? [
          { label: 'Batch ID',       value: selected.id },
          { label: 'Machine ID',     value: selected.machineId },
          { label: 'Subscription',   value: selected.subscriptionId },
          { label: 'Cursor',         value: String(selected.cursor) },
          { label: 'Event Count',    value: String(selected.eventCount) },
          { label: 'First Type',     value: selected.firstEventType },
          { label: 'Received At',    value: new Date(selected.receivedAt).toISOString() },
        ] : []}
      />
    </div>
  );
}
