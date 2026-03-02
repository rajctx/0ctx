'use client';

import { useState, useEffect, useCallback } from 'react';
import { StatusBadge } from '@/components/logs/status-badge';
import { Sparkline } from '@/components/logs/sparkline';
import { fmtAgo, fmtUptime } from '@/lib/log-format';
import { useVisibleInterval } from '@/lib/use-visible-interval';

interface StaleConnector {
  machineId: string;
  lastHeartbeatAt: number | null;
}

interface HealthData {
  uptimeMs: number;
  storeBackend: 'postgres' | 'memory';
  connectorCounts: {
    total: number;
    connected: number;
    degraded: number;
    offline: number;
  };
  commandCounts: {
    pending: number;
    applied: number;
    failed: number;
  };
  staleConnectors: StaleConnector[];
}

// Build a simple sparkline history from snapshots
function useHistory<T>(value: T, maxLen = 20): T[] {
  const [history, setHistory] = useState<T[]>([]);
  useEffect(() => {
    setHistory(prev => [...prev.slice(-(maxLen - 1)), value]);
  }, [value]);
  return history;
}

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());

  const load = useCallback(async () => {
    const res = await fetch('/api/v1/logs/health');
    if (!res.ok) {
      setError(`Failed to load health data (${res.status})`);
      setLoading(false);
      return;
    }
    const d = await res.json() as HealthData;
    setData(d);
    setError(null);
    setLoading(false);
    setLastRefresh(Date.now());
  }, []);

  useEffect(() => { load(); }, [load]);
  useVisibleInterval(load, 15_000);

  // Command queue sparkline history (normalized 0–1 by total)
  const pendingHistory = useHistory(
    data ? (data.commandCounts.pending / Math.max(1, data.commandCounts.pending + data.commandCounts.applied + data.commandCounts.failed)) : 0
  );
  const failedHistory = useHistory(
    data ? (data.commandCounts.failed / Math.max(1, data.commandCounts.pending + data.commandCounts.applied + data.commandCounts.failed)) : 0
  );

  if (loading) {
    return <div className="l-empty">Loading health data...<span className="l-cursor" /></div>;
  }

  if (error || !data) {
    return (
      <div className="l-empty" style={{ color: 'var(--l-red)' }}>
        {error ?? 'No health data available.'}
      </div>
    );
  }

  const { connectorCounts, commandCounts, storeBackend, uptimeMs, staleConnectors } = data;
  const connectorHealthPct = connectorCounts.total === 0
    ? 0
    : Math.round((connectorCounts.connected / connectorCounts.total) * 100);

  return (
    <div style={{ padding: '0' }}>

      {/* Top status bar */}
      <div className="l-toolbar" style={{ marginBottom: 8 }}>
        <span style={{ color: 'var(--l-dim)', fontSize: 11 }}>
          {'>'} UPTIME: <b style={{ color: 'white' }}>{fmtUptime(uptimeMs)}</b>
          {'  '}//{'  '}
          BACKEND: <b style={{ color: storeBackend === 'postgres' ? 'var(--l-green)' : 'var(--l-amber)' }}>
            {storeBackend.toUpperCase()}
          </b>
          {'  '}//{'  '}
          REFRESHED: <b style={{ color: 'white' }}>{fmtAgo(lastRefresh)}</b>
        </span>
        <div style={{ flex: 1 }} />
        <button className="l-btn" onClick={load}>↻ REFRESH</button>
      </div>

      {/* Connector posture grid */}
      <div style={{ marginBottom: 16 }}>
        <div className="l-section-title">// CONNECTOR FLEET</div>
        <div className="l-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="l-card">
            <div className="l-card-label">TOTAL</div>
            <div className="l-card-value">{connectorCounts.total}</div>
          </div>
          <div className="l-card">
            <div className="l-card-label">CONNECTED</div>
            <div className="l-card-value" style={{ color: 'var(--l-green)' }}>
              {connectorCounts.connected}
            </div>
          </div>
          <div className="l-card">
            <div className="l-card-label">DEGRADED</div>
            <div className="l-card-value" style={{ color: 'var(--l-amber)' }}>
              {connectorCounts.degraded}
            </div>
          </div>
          <div className="l-card">
            <div className="l-card-label">OFFLINE</div>
            <div className="l-card-value" style={{ color: connectorCounts.offline > 0 ? 'var(--l-red)' : 'var(--l-dim)' }}>
              {connectorCounts.offline}
            </div>
          </div>
        </div>

        {/* Health bar */}
        {connectorCounts.total > 0 && (
          <div style={{ marginTop: 8, padding: '0 2px' }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, color: 'var(--l-dim)', marginBottom: 4 }}>
              <span>FLEET HEALTH:</span>
              <span style={{
                color: connectorHealthPct >= 80 ? 'var(--l-green)' : connectorHealthPct >= 50 ? 'var(--l-amber)' : 'var(--l-red)',
                fontWeight: 700,
              }}>
                {connectorHealthPct}%
              </span>
            </div>
            <div style={{
              height: 4,
              background: '#1a1a1a',
              borderRadius: 2,
              overflow: 'hidden',
            }}>
              {/* connected segment */}
              <div style={{
                display: 'flex',
                height: '100%',
              }}>
                <div style={{
                  width: `${connectorCounts.total > 0 ? (connectorCounts.connected / connectorCounts.total) * 100 : 0}%`,
                  background: 'var(--l-green)',
                }} />
                <div style={{
                  width: `${connectorCounts.total > 0 ? (connectorCounts.degraded / connectorCounts.total) * 100 : 0}%`,
                  background: 'var(--l-amber)',
                }} />
                <div style={{
                  width: `${connectorCounts.total > 0 ? (connectorCounts.offline / connectorCounts.total) * 100 : 0}%`,
                  background: 'var(--l-red)',
                }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Command queue */}
      <div style={{ marginBottom: 16 }}>
        <div className="l-section-title">// COMMAND QUEUE</div>
        <div className="l-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="l-card">
            <div className="l-card-label">PENDING</div>
            <div className="l-card-value" style={{ color: commandCounts.pending > 0 ? 'var(--l-amber)' : 'var(--l-dim)' }}>
              {commandCounts.pending}
            </div>
            <Sparkline values={pendingHistory} />
          </div>
          <div className="l-card">
            <div className="l-card-label">APPLIED</div>
            <div className="l-card-value" style={{ color: 'var(--l-green)' }}>
              {commandCounts.applied}
            </div>
          </div>
          <div className="l-card">
            <div className="l-card-label">FAILED</div>
            <div className="l-card-value" style={{ color: commandCounts.failed > 0 ? 'var(--l-red)' : 'var(--l-dim)' }}>
              {commandCounts.failed}
            </div>
            <Sparkline values={failedHistory} />
          </div>
        </div>
      </div>

      {/* Backend services */}
      <div style={{ marginBottom: 16 }}>
        <div className="l-section-title">// BACKEND SERVICES</div>
        <table className="l-table" style={{ marginTop: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 8 }} />
              <th>SERVICE</th>
              <th>STATUS</th>
              <th>DETAIL</th>
            </tr>
          </thead>
          <tbody>
            <tr className="t-applied">
              <td />
              <td>API SERVER</td>
              <td><StatusBadge variant="connected" /></td>
              <td className="l-dim" style={{ fontSize: 11 }}>responding · uptime {fmtUptime(uptimeMs)}</td>
            </tr>
            <tr className={storeBackend === 'postgres' ? 't-applied' : 't-heartbeat'}>
              <td />
              <td>DATA STORE</td>
              <td>
                <StatusBadge
                  variant={storeBackend === 'postgres' ? 'connected' : 'degraded'}
                  label={storeBackend === 'postgres' ? 'POSTGRES' : 'MEMORY'}
                />
              </td>
              <td className="l-dim" style={{ fontSize: 11 }}>
                {storeBackend === 'postgres'
                  ? 'persistent · neon / postgres'
                  : 'in-memory · data lost on restart · set DATABASE_URL for postgres'}
              </td>
            </tr>
            <tr className={connectorCounts.total > 0 ? 't-applied' : 't-event'}>
              <td />
              <td>CONNECTOR MESH</td>
              <td>
                <StatusBadge
                  variant={
                    connectorCounts.total === 0 ? 'offline'
                      : connectorCounts.connected > 0 ? 'connected'
                        : connectorCounts.degraded > 0 ? 'degraded'
                          : 'offline'
                  }
                />
              </td>
              <td className="l-dim" style={{ fontSize: 11 }}>
                {connectorCounts.total === 0
                  ? 'no connectors registered'
                  : `${connectorCounts.connected} active · ${connectorCounts.degraded} degraded · ${connectorCounts.offline} offline`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Stale connectors warning */}
      {staleConnectors.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="l-section-title" style={{ color: 'var(--l-red)' }}>// STALE CONNECTORS</div>
          <table className="l-table" style={{ marginTop: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 8 }} />
                <th>CONNECTOR ID</th>
                <th>LAST HEARTBEAT</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {staleConnectors.map(sc => (
                <tr key={sc.machineId} className="t-failed">
                  <td />
                  <td>{sc.machineId}</td>
                  <td style={{ color: 'var(--l-red)' }}>{fmtAgo(sc.lastHeartbeatAt, 'never')}</td>
                  <td className="l-dim" style={{ fontSize: 11 }}>
                    run <code>0ctx connector register</code> on that machine
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}
