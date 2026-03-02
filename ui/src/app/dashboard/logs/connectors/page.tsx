'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { StatusBadge } from '@/components/logs/status-badge';
import { fmtAgo } from '@/lib/log-format';
import { useVisibleInterval } from '@/lib/use-visible-interval';

interface ConnectorRow {
  machineId: string;
  posture: string;
  trustLevel: string;
  capabilities: string[];
  lastHeartbeatAt: number | null;
  registeredAt: number;
  staleHeartbeat: boolean;
}

export default function ConnectorsPage() {
  const router = useRouter();
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [counts, setCounts] = useState({ total: 0, connected: 0, degraded: 0, offline: 0 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch('/api/v1/logs/connectors');
    if (!res.ok) return;
    const data = await res.json() as { connectors: ConnectorRow[]; counts: typeof counts };
    setConnectors(data.connectors);
    setCounts(data.counts);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useVisibleInterval(load, 30_000);

  const visible = connectors.filter(c =>
    !search || c.machineId.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="l-toolbar">
        <div className="l-stats-bar" style={{ marginBottom: 0 }}>
          <span>TOTAL: <b className="l-stat-val">{counts.total}</b></span>
          <span>CONNECTED: <b className="l-stat-val green">{counts.connected}</b></span>
          <span>DEGRADED: <b className="l-stat-val amber">{counts.degraded}</b></span>
          <span>OFFLINE: <b className="l-stat-val red">{counts.offline}</b></span>
        </div>
        <div style={{ flex: 1 }} />
        <input
          type="text"
          placeholder="FILTER ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="l-filter-input"
        />
      </div>

      {loading ? (
        <div className="l-empty">Loading connectors...<span className="l-cursor" /></div>
      ) : visible.length === 0 ? (
        <div className="l-empty">
          No connectors registered yet.<br />
          Run <code>0ctx connector register</code> on a machine to add it.
        </div>
      ) : (
        <table className="l-table">
          <thead>
            <tr>
              <th style={{ width: 8 }} />
              <th>STATUS</th>
              <th>CONNECTOR ID</th>
              <th>TRUST</th>
              <th>LAST HEARTBEAT</th>
              <th>REGISTERED</th>
              <th>CAPABILITIES</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(c => (
              <tr
                key={c.machineId}
                className={`t-${c.posture === 'connected' ? 'applied' : c.posture === 'degraded' ? 'heartbeat' : 'failed'}`}
                onClick={() => router.push(`/dashboard/logs/connectors/${encodeURIComponent(c.machineId)}`)}
              >
                <td />
                <td><StatusBadge variant={c.posture as 'connected' | 'offline' | 'degraded'} /></td>
                <td>{c.machineId}</td>
                <td>
                  <StatusBadge
                    variant={c.trustLevel === 'verified' ? 'verified' : 'unverified'}
                    label={c.trustLevel}
                  />
                </td>
                <td style={{ color: c.staleHeartbeat ? 'var(--l-red)' : undefined }}>
                  {fmtAgo(c.lastHeartbeatAt)}
                </td>
                <td className="l-dim">{new Date(c.registeredAt).toLocaleDateString()}</td>
                <td className="l-dim" style={{ fontSize: 11 }}>{c.capabilities.join(', ') || '--'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
