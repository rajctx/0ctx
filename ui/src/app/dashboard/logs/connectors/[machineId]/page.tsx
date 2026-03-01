'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { StatusBadge } from '@/components/logs/status-badge';
import { Sparkline } from '@/components/logs/sparkline';
import { fmtAgo } from '@/lib/log-format';

interface ConnectorDetail {
  machineId: string;
  posture: string;
  trustLevel: string;
  trustVerifiedAt: number | null;
  capabilities: string[];
  registeredAt: number;
  lastHeartbeatAt: number | null;
  staleHeartbeat: boolean;
}
interface CommandRow { commandId: string; method: string; status: string; createdAt: number; error?: string; }
interface EventRow   { id: string; subscriptionId: string; cursor: number; receivedAt: number; eventCount: number; firstEventType: string; }

export default function ConnectorDetailPage() {
  const { machineId } = useParams<{ machineId: string }>();
  const router = useRouter();
  const [connector, setConnector] = useState<ConnectorDetail | null>(null);
  const [commands, setCommands]   = useState<CommandRow[]>([]);
  const [events, setEvents]       = useState<EventRow[]>([]);

  useEffect(() => {
    const decoded = decodeURIComponent(machineId);
    Promise.all([
      fetch(`/api/v1/logs/connectors?machineId=${encodeURIComponent(decoded)}`).then(r => r.json()),
      fetch(`/api/v1/logs/commands?machineId=${encodeURIComponent(decoded)}&limit=20`).then(r => r.json()),
      fetch(`/api/v1/logs/events?machineId=${encodeURIComponent(decoded)}&limit=20`).then(r => r.json()),
    ]).then(([connData, cmdData, evData]) => {
      setConnector((connData.connectors as ConnectorDetail[])[0] ?? null);
      setCommands(cmdData.commands ?? []);
      setEvents(evData.events ?? []);
    });
  }, [machineId]);

  if (!connector) {
    return <div className="l-empty">Loading...<span className="l-cursor" /></div>;
  }

  // Fake sparkline: 1 = heartbeat present, 0 = gap (we just show bars for now)
  const sparkValues = Array(16).fill(0.8);

  return (
    <div>
      <button className="l-btn" style={{ marginBottom: 16 }} onClick={() => router.back()}>
        &lt; BACK
      </button>

      {/* Header card */}
      <div style={{ border: '1px solid #222', padding: 16, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 18, color: 'var(--l-accent-white)', fontWeight: 'bold' }}>{connector.machineId}</div>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--l-text-dim)' }}>
            REGISTERED: {new Date(connector.registeredAt).toISOString()} &nbsp;//&nbsp;
            CAPS: {connector.capabilities.join(', ') || 'none'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <StatusBadge variant={connector.posture as 'connected' | 'offline' | 'degraded'} />
          <div style={{ marginTop: 6, fontSize: 10, color: 'var(--l-amber)' }}>
            TRUST: {connector.trustLevel.toUpperCase()}
            {connector.trustVerifiedAt ? ` (${fmtAgo(connector.trustVerifiedAt)})` : ''}
          </div>
        </div>
      </div>

      {/* Metric cards */}
      <div className="l-grid" style={{ marginBottom: 20 }}>
        <div className="l-card">
          <h3>Heartbeat History</h3>
          <Sparkline values={sparkValues} height={36} />
          <div className="l-stat-detail" style={{ marginTop: 8 }}>Last: {fmtAgo(connector.lastHeartbeatAt)}</div>
        </div>
        <div className="l-card">
          <h3>Trust Status</h3>
          <div className="l-stat-num" style={{ color: connector.trustLevel === 'verified' ? 'var(--l-green)' : 'var(--l-amber)' }}>
            {connector.trustLevel.toUpperCase()}
          </div>
          {connector.trustVerifiedAt && (
            <div className="l-stat-detail">Verified {fmtAgo(connector.trustVerifiedAt)}</div>
          )}
        </div>
      </div>

      {/* Commands */}
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ borderBottom: '1px solid #222', paddingBottom: 8, marginBottom: 12, fontSize: 12, color: 'var(--l-text-muted)' }}>
          RECENT COMMANDS
        </h3>
        {commands.length === 0 ? (
          <div className="l-dim" style={{ fontSize: 12, padding: '12px 0' }}>No commands yet.</div>
        ) : (
          <table className="l-table">
            <thead><tr><th style={{ width: 8 }}/><th>METHOD</th><th>STATUS</th><th>CREATED</th><th>ERROR</th></tr></thead>
            <tbody>
              {commands.map(cmd => (
                <tr key={cmd.commandId} className={`t-${cmd.status}`}>
                  <td />
                  <td>{cmd.method}</td>
                  <td><StatusBadge variant={cmd.status as 'applied' | 'failed' | 'pending'} /></td>
                  <td className="l-dim">{fmtAgo(cmd.createdAt)}</td>
                  <td className="l-dim" style={{ fontSize: 11 }}>{cmd.error ?? '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Events */}
      <div>
        <h3 style={{ borderBottom: '1px solid #222', paddingBottom: 8, marginBottom: 12, fontSize: 12, color: 'var(--l-text-muted)' }}>
          RECENT EVENT BATCHES
        </h3>
        {events.length === 0 ? (
          <div className="l-dim" style={{ fontSize: 12, padding: '12px 0' }}>No events ingested yet.</div>
        ) : (
          <table className="l-table">
            <thead><tr><th style={{ width: 8 }}/><th>RECEIVED</th><th>SUBSCRIPTION</th><th>CURSOR</th><th>COUNT</th><th>TYPE</th></tr></thead>
            <tbody>
              {events.map(ev => (
                <tr key={ev.id} className="t-event">
                  <td />
                  <td className="l-dim">{fmtAgo(ev.receivedAt)}</td>
                  <td className="l-dim" style={{ fontSize: 11 }}>{ev.subscriptionId.slice(0, 16)}…</td>
                  <td className="l-dim">{ev.cursor}</td>
                  <td>{ev.eventCount}</td>
                  <td className="l-dim">{ev.firstEventType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
