'use client';

import { useState, useEffect, useCallback } from 'react';
import { StatusBadge } from '@/components/logs/status-badge';
import { fmtAgo, fmtTsISO, fmtBytes } from '@/lib/log-format';
import { useVisibleInterval } from '@/lib/use-visible-interval';

// ── Types ────────────────────────────────────────────────────────────────────

interface SyncStats {
  totalEnvelopes: number;
  uniqueContexts: number;
  encryptedCount: number;
  plainCount: number;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
  windowDays: number;
}

interface ContextSummary {
  contextId: string;
  envelopeCount: number;
  latestTimestamp: number;
  latestReceivedAt: number;
  encrypted: boolean;
  syncPolicy: string | undefined;
  userId: string;
}

interface EnvelopeRecord {
  id: string;
  contextId: string;
  userId: string;
  timestamp: number;
  receivedAt: number;
  encrypted: boolean;
  syncPolicy: string | null;
  payloadBytes: number;
}

// ── Helpers (sync-page-specific) ─────────────────────────────────────────────

function shortId(id: string) {
  // e.g. "ctx-abc123def456" → show first 20 chars
  return id.length > 28 ? `${id.slice(0, 24)}…` : id;
}

function policyColor(policy: string | undefined | null): string {
  if (policy === 'full_sync')     return 'var(--l-green)';
  if (policy === 'metadata_only') return 'var(--l-amber)';
  if (policy === 'local_only')    return 'var(--l-dim)';
  return 'var(--l-dim)';
}

// ── Component ────────────────────────────────────────────────────────────────

export default function SyncContextsPage() {
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [contexts, setContexts] = useState<ContextSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());
  const [search, setSearch] = useState('');

  // Detail panel
  const [selected, setSelected] = useState<ContextSummary | null>(null);
  const [envelopes, setEnvelopes] = useState<EnvelopeRecord[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // ── Load summary ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/logs/sync');
      if (!res.ok) {
        setError(`HTTP ${res.status} — failed to load sync data`);
        setLoading(false);
        return;
      }
      const d = await res.json() as { stats: SyncStats; contexts: ContextSummary[] };
      setStats(d.stats);
      setContexts(d.contexts);
      setError(null);
      setLastRefresh(Date.now());
    } catch {
      setError('Network error — could not reach sync API');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useVisibleInterval(load, 30_000);

  // ── Load detail ─────────────────────────────────────────────────────────────
  const loadDetail = useCallback(async (ctx: ContextSummary) => {
    setSelected(ctx);
    setDetailLoading(true);
    setEnvelopes([]);
    try {
      const res = await fetch(
        `/api/v1/logs/sync?contextId=${encodeURIComponent(ctx.contextId)}`
      );
      if (res.ok) {
        const d = await res.json() as { envelopes?: EnvelopeRecord[] };
        setEnvelopes(d.envelopes ?? []);
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // ── Filtered contexts ───────────────────────────────────────────────────────
  const filtered = search
    ? contexts.filter(c =>
        c.contextId.toLowerCase().includes(search.toLowerCase()) ||
        (c.userId && c.userId.toLowerCase().includes(search.toLowerCase()))
      )
    : contexts;

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="l-empty">Loading sync contexts...<span className="l-cursor" /></div>;
  }

  if (error) {
    return (
      <div className="l-empty" style={{ color: 'var(--l-red)' }}>
        {error}
        <br />
        <button className="l-btn" style={{ marginTop: 12 }} onClick={load}>RETRY</button>
      </div>
    );
  }

  const allEncrypted = stats && stats.totalEnvelopes > 0 && stats.encryptedCount === stats.totalEnvelopes;

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>

      {/* ── Left: main content ── */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 0 }}>

        {/* Toolbar */}
        <div className="l-toolbar" style={{ marginBottom: 8 }}>
          <span style={{ color: 'var(--l-dim)', fontSize: 11 }}>
            {'>'} WINDOW: <b style={{ color: 'white' }}>30 DAYS</b>
            {'  '}//{' '}
            REFRESHED: <b style={{ color: 'white' }}>{fmtAgo(lastRefresh)}</b>
          </span>
          <div style={{ flex: 1 }} />
          <input
            className="l-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by context ID or user…"
            style={{ width: 260 }}
          />
          <button className="l-btn" onClick={load}>↻ REFRESH</button>
        </div>

        {/* Stats cards */}
        {stats && (
          <div style={{ marginBottom: 16 }}>
            <div className="l-section-title">// SYNC OVERVIEW</div>
            <div className="l-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <div className="l-card">
                <div className="l-card-label">ENVELOPES STORED</div>
                <div className="l-card-value">{stats.totalEnvelopes}</div>
                <div className="l-stat-detail">last {stats.windowDays} days</div>
              </div>
              <div className="l-card">
                <div className="l-card-label">UNIQUE CONTEXTS</div>
                <div className="l-card-value" style={{ color: 'var(--l-accent-white)' }}>
                  {stats.uniqueContexts}
                </div>
              </div>
              <div className="l-card">
                <div className="l-card-label">ENCRYPTED</div>
                <div className="l-card-value" style={{ color: 'var(--l-green)' }}>
                  {stats.encryptedCount}
                </div>
                <div className="l-stat-detail">
                  {stats.totalEnvelopes > 0
                    ? `${Math.round((stats.encryptedCount / stats.totalEnvelopes) * 100)}%`
                    : '—'}
                </div>
              </div>
              <div className="l-card">
                <div className="l-card-label">LAST SYNC</div>
                <div className="l-card-value" style={{ fontSize: 18 }}>
                  {stats.newestTimestamp ? fmtAgo(stats.newestTimestamp) : '—'}
                </div>
                <div className="l-stat-detail">
                  {stats.newestTimestamp ? fmtTsISO(stats.newestTimestamp) : 'no syncs yet'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Encryption note */}
        {allEncrypted && (
          <div style={{
            marginBottom: 12,
            padding: '8px 12px',
            border: '1px solid #2a2a1a',
            background: '#181810',
            fontSize: 11,
            color: 'var(--l-amber)',
          }}>
            {'> '} All envelopes are <b>encrypted</b>. Payloads cannot be decrypted on the server.
            For cross-device decryption, ensure <code>CTX_MASTER_KEY</code> is set identically on all devices.
          </div>
        )}

        {/* Contexts table */}
        <div className="l-section-title">// SYNCED CONTEXTS</div>

        {filtered.length === 0 ? (
          <div className="l-empty" style={{ padding: '24px 0' }}>
            {contexts.length === 0
              ? 'No sync envelopes found in the last 30 days. Run the daemon with sync enabled to start syncing context.'
              : 'No contexts match your filter.'}
          </div>
        ) : (
          <table className="l-table" style={{ marginTop: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 8 }} />
                <th>CONTEXT ID</th>
                <th>ENVELOPES</th>
                <th>POLICY</th>
                <th>ENCRYPTED</th>
                <th>LAST SYNC</th>
                <th>USER</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(ctx => (
                <tr
                  key={ctx.contextId}
                  className={`t-event${selected?.contextId === ctx.contextId ? ' t-selected' : ''}`}
                  onClick={() => loadDetail(ctx)}
                  style={{ cursor: 'pointer' }}
                >
                  <td />
                  <td style={{ fontFamily: 'monospace', color: 'var(--l-accent-white)', fontSize: 12 }}>
                    {shortId(ctx.contextId)}
                  </td>
                  <td style={{ color: 'var(--l-text)', fontWeight: 600 }}>
                    {ctx.envelopeCount}
                  </td>
                  <td>
                    <span style={{
                      fontSize: 10,
                      color: policyColor(ctx.syncPolicy),
                      textTransform: 'uppercase',
                      letterSpacing: 1,
                    }}>
                      {ctx.syncPolicy ?? 'unknown'}
                    </span>
                  </td>
                  <td>
                    <StatusBadge
                      variant={ctx.encrypted ? 'connected' : 'degraded'}
                      label={ctx.encrypted ? 'YES' : 'NO'}
                    />
                  </td>
                  <td className="l-dim">{fmtAgo(ctx.latestTimestamp)}</td>
                  <td className="l-dim" style={{ fontSize: 11 }}>
                    {ctx.userId ? ctx.userId.slice(0, 24) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      </div>

      {/* ── Right: detail panel ── */}
      {selected && (
        <div style={{
          width: 420,
          borderLeft: '1px solid #1a1a1a',
          background: '#060606',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          {/* Panel header */}
          <div style={{
            padding: '10px 14px',
            borderBottom: '1px solid #1a1a1a',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ fontSize: 11, color: 'var(--l-text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
              Context Detail
            </span>
            <button
              className="l-btn"
              style={{ padding: '2px 8px', fontSize: 10 }}
              onClick={() => setSelected(null)}
            >
              ✕ CLOSE
            </button>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
            {/* Context metadata */}
            <div style={{ marginBottom: 14 }}>
              <div className="l-section-title">// CONTEXT</div>
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <tbody>
                  {[
                    ['ID', selected.contextId],
                    ['USER', selected.userId || '—'],
                    ['POLICY', selected.syncPolicy ?? 'unknown'],
                    ['ENCRYPTED', selected.encrypted ? 'YES' : 'NO'],
                    ['ENVELOPE COUNT', String(selected.envelopeCount)],
                    ['LAST SYNC', fmtTsISO(selected.latestTimestamp)],
                    ['RECEIVED', fmtTsISO(selected.latestReceivedAt)],
                  ].map(([k, v]) => (
                    <tr key={k} style={{ borderBottom: '1px solid #0d0d0d' }}>
                      <td style={{
                        padding: '4px 0',
                        color: 'var(--l-text-muted)',
                        width: 100,
                        verticalAlign: 'top',
                        letterSpacing: '0.5px',
                      }}>{k}</td>
                      <td style={{
                        padding: '4px 0',
                        color: 'var(--l-text)',
                        fontFamily: 'monospace',
                        wordBreak: 'break-all',
                      }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Individual envelopes */}
            <div className="l-section-title">// ENVELOPE HISTORY (LAST 50)</div>
            {detailLoading ? (
              <div className="l-dim" style={{ fontSize: 11, paddingTop: 8 }}>
                Loading envelopes…
              </div>
            ) : envelopes.length === 0 ? (
              <div className="l-dim" style={{ fontSize: 11, paddingTop: 8 }}>
                No envelopes found.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {envelopes.map(env => (
                  <div
                    key={env.id}
                    style={{
                      padding: '6px 8px',
                      border: '1px solid #141414',
                      background: '#080808',
                      fontSize: 10,
                      fontFamily: 'monospace',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ color: 'var(--l-dim)' }}>
                        {env.id.slice(0, 16)}…
                      </span>
                      <span style={{
                        color: env.encrypted ? 'var(--l-green)' : 'var(--l-amber)',
                        textTransform: 'uppercase',
                        letterSpacing: 1,
                      }}>
                        {env.encrypted ? '🔒 ENC' : '⚠ PLAIN'}
                      </span>
                    </div>
                    <div style={{ color: 'var(--l-text-muted)', marginBottom: 2 }}>
                      {fmtTsISO(env.timestamp)} · {fmtBytes(env.payloadBytes)}
                    </div>
                    <div style={{ color: policyColor(env.syncPolicy), textTransform: 'uppercase' }}>
                      {env.syncPolicy ?? 'no-policy'}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Decryption note */}
            {selected.encrypted && (
              <div style={{
                marginTop: 14,
                padding: 8,
                border: '1px solid #2a1a00',
                background: '#100b00',
                fontSize: 10,
                color: 'var(--l-amber)',
                lineHeight: 1.5,
              }}>
                Payload is AES-256-GCM encrypted.
                The server stores only the ciphertext — decryption happens on the daemon using{' '}
                <code style={{ background: '#1a1000', padding: '0 2px' }}>~/.0ctx/master.key</code>.
                To sync across devices, export the key with{' '}
                <code style={{ background: '#1a1000', padding: '0 2px' }}>0ctx key export</code>.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
