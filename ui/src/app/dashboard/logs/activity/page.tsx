'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { DetailPanel } from '@/components/logs/detail-panel';
import { fmtTs } from '@/lib/log-format';
import { useVisibleInterval } from '@/lib/use-visible-interval';
import type { ActivityItem } from '@/app/api/v1/logs/activity/route';

type Filter = 'all' | 'command' | 'event' | 'heartbeat';

export default function ActivityPage() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<ActivityItem | null>(null);
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const sseActiveRef = useRef(false);

  const load = useCallback(async () => {
    if (pausedRef.current) return;
    const res = await fetch('/api/v1/logs/activity?limit=100');
    if (!res.ok) return;
    const data = await res.json() as { items: ActivityItem[] };
    setItems(data.items);
  }, []);

  // SSE for real-time updates — replaces polling when available
  useEffect(() => {
    load();

    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/v1/events/stream');
      es.addEventListener('open', () => { sseActiveRef.current = true; });
      es.addEventListener('message', () => {
        if (!pausedRef.current) load();
      });
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
  }, 10_000);

  const visible = filter === 'all' ? items : items.filter(i => i.category === filter);

  return (
    <div>
      <div className="l-toolbar">
        <button
          className={`l-btn action`}
          onClick={() => setPaused(p => !p)}
        >
          {paused ? '> RESUME' : '|| PAUSE'}
        </button>
        <div style={{ flex: 1 }} />
        {(['all', 'command', 'event', 'heartbeat'] as Filter[]).map(f => (
          <button
            key={f}
            className={`l-btn${filter === f ? ' active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="l-empty">
          No activity yet.<br />
          Connect a machine with <code>0ctx connector register</code> to see events here.
        </div>
      ) : (
        <table className="l-table">
          <thead>
            <tr>
              <th style={{ width: 8 }} />
              <th>TIMESTAMP</th>
              <th>SOURCE</th>
              <th>TYPE</th>
              <th>MESSAGE</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(item => (
              <tr
                key={item.id}
                className={`t-${item.category === 'command' ? (item.status ?? 'command') : item.category}${selected?.id === item.id ? ' row-selected' : ''}`}
                onClick={() => setSelected(item)}
              >
                <td />
                <td className="l-dim">{fmtTs(item.ts)}</td>
                <td>{item.machineId}</td>
                <td>{item.type}</td>
                <td className="l-dim" style={{ fontSize: 11 }}>{item.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DetailPanel
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.type ?? '--'}
        subtitle={selected ? `${new Date(selected.ts).toISOString()} · ${selected.machineId}` : undefined}
        accentColor={selected?.accentColor}
        metadata={selected ? [
          { label: 'Event ID',   value: selected.id },
          { label: 'Timestamp',  value: new Date(selected.ts).toISOString() },
          { label: 'Source',     value: selected.machineId },
          { label: 'Category',   value: selected.category },
          { label: 'Type',       value: selected.type },
          { label: 'Status',     value: selected.status ?? '--' },
        ] : []}
        payload={selected ? JSON.stringify({ message: selected.message, status: selected.status }, null, 2) : undefined}
      />
    </div>
  );
}
