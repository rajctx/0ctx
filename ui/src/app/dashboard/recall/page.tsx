'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, History, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { getGraphData, listRecallFeedbackAction, RecallFeedbackItem, RecallFeedbackSummary } from '@/app/actions';
import { useDashboardState } from '@/components/dashboard/dashboard-state-provider';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { asNodeType, GraphNode, NODE_TYPE_META } from '@/lib/graph';
import { cn, formatTimestamp } from '@/lib/ui';

type RecallScope = 'active' | 'all';
type HelpfulFilter = 'all' | 'helpful' | 'not_helpful';

type TrendBucket = {
  key: string;
  label: string;
  helpful: number;
  notHelpful: number;
  total: number;
};

type NodeFeedbackStat = {
  nodeId: string;
  helpful: number;
  notHelpful: number;
  netScore: number;
  lastFeedbackAt: number;
};

function compactText(value: string, maxLength = 80): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function toLocalDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildTrendBuckets(items: RecallFeedbackItem[], days: number): TrendBucket[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets: TrendBucket[] = [];
  const byKey = new Map<string, TrendBucket>();

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - offset);
    const key = toLocalDateKey(day.getTime());
    const bucket: TrendBucket = {
      key,
      label: day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      helpful: 0,
      notHelpful: 0,
      total: 0
    };
    buckets.push(bucket);
    byKey.set(key, bucket);
  }

  for (const item of items) {
    if (typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt)) continue;
    const bucket = byKey.get(toLocalDateKey(item.createdAt));
    if (!bucket) continue;
    if (item.helpful) {
      bucket.helpful += 1;
    } else {
      bucket.notHelpful += 1;
    }
    bucket.total += 1;
  }

  return buckets;
}

function buildNodeStats(items: RecallFeedbackItem[]): NodeFeedbackStat[] {
  const byNode = new Map<string, NodeFeedbackStat>();
  for (const item of items) {
    const nodeId = item.nodeId?.trim();
    if (!nodeId) continue;
    const current = byNode.get(nodeId) ?? {
      nodeId,
      helpful: 0,
      notHelpful: 0,
      netScore: 0,
      lastFeedbackAt: 0
    };
    if (item.helpful) {
      current.helpful += 1;
    } else {
      current.notHelpful += 1;
    }
    current.netScore = current.helpful - current.notHelpful;
    if (typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)) {
      current.lastFeedbackAt = Math.max(current.lastFeedbackAt, item.createdAt);
    }
    byNode.set(nodeId, current);
  }
  return Array.from(byNode.values());
}

export default function DashboardRecallPage() {
  const { activeContext, activeContextId, selectedMachineId } = useDashboardState();
  const [scope, setScope] = useState<RecallScope>('active');
  const [helpfulFilter, setHelpfulFilter] = useState<HelpfulFilter>('all');
  const [includeChatDumps, setIncludeChatDumps] = useState(false);
  const [nodeFilter, setNodeFilter] = useState('');
  const [summary, setSummary] = useState<RecallFeedbackSummary | null>(null);
  const [contextNodes, setContextNodes] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshRecall = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (scope === 'active' && !activeContextId) {
        setSummary(null);
        setContextNodes([]);
        return;
      }
      const contextId = scope === 'active' ? activeContextId : null;
      const helpful = helpfulFilter === 'all' ? undefined : helpfulFilter === 'helpful';
      const [nextSummary, graph] = await Promise.all([
        listRecallFeedbackAction({
          contextId,
          nodeId: nodeFilter || undefined,
          helpful,
          limit: 250,
          machineId: selectedMachineId
        }),
        activeContextId
          ? getGraphData(activeContextId, selectedMachineId, { includeHidden: includeChatDumps })
          : Promise.resolve({ nodes: [], edges: [] })
      ]);
      setSummary(nextSummary);
      const nextNodes = [...(graph?.nodes ?? [])].sort((a, b) => b.createdAt - a.createdAt);
      setContextNodes(nextNodes);
      if (nodeFilter && !nextNodes.some(node => node.id === nodeFilter)) {
        setNodeFilter('');
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to load recall feedback.');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [activeContextId, helpfulFilter, includeChatDumps, nodeFilter, scope, selectedMachineId]);

  useEffect(() => {
    void refreshRecall();
  }, [refreshRecall]);

  const items = summary?.items ?? [];
  const nodeStats = useMemo(() => buildNodeStats(items), [items]);
  const trend = useMemo(() => buildTrendBuckets(items, 7), [items]);

  const nodeMap = useMemo(() => {
    return new Map(contextNodes.map(node => [node.id, node]));
  }, [contextNodes]);

  const topImproved = useMemo(() => {
    return [...nodeStats]
      .sort((a, b) => b.netScore - a.netScore || b.helpful - a.helpful || b.lastFeedbackAt - a.lastFeedbackAt)
      .slice(0, 6);
  }, [nodeStats]);

  const needsAttention = useMemo(() => {
    return [...nodeStats]
      .sort((a, b) => a.netScore - b.netScore || b.notHelpful - a.notHelpful || b.lastFeedbackAt - a.lastFeedbackAt)
      .slice(0, 6);
  }, [nodeStats]);

  const recentItems = useMemo(() => {
    return [...items]
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, 20);
  }, [items]);

  return (
    <div className="space-y-4 p-3 md:p-4">
      <Panel className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Recall Analytics</h2>
          </div>
          <Button variant="secondary" size="sm" onClick={refreshRecall} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>

        <div className="grid gap-2 text-xs md:grid-cols-3">
          <div className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2">
            <p className="text-[var(--text-muted)]">total feedback</p>
            <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{summary?.total ?? 0}</p>
          </div>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
            <p className="text-emerald-200">helpful</p>
            <p className="mt-1 text-sm font-semibold text-emerald-100">{summary?.helpfulCount ?? 0}</p>
          </div>
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2">
            <p className="text-rose-200">not helpful</p>
            <p className="mt-1 text-sm font-semibold text-rose-100">{summary?.notHelpfulCount ?? 0}</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setScope('active')}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                scope === 'active'
                  ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                  : 'border-[var(--border-muted)] bg-[var(--surface-subtle)] text-[var(--text-muted)]'
              )}
            >
              Active context
            </button>
            <button
              type="button"
              onClick={() => setScope('all')}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                scope === 'all'
                  ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                  : 'border-[var(--border-muted)] bg-[var(--surface-subtle)] text-[var(--text-muted)]'
              )}
            >
              All contexts
            </button>
          </div>

          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setHelpfulFilter('all')}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                helpfulFilter === 'all'
                  ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                  : 'border-[var(--border-muted)] bg-[var(--surface-subtle)] text-[var(--text-muted)]'
              )}
            >
              All feedback
            </button>
            <button
              type="button"
              onClick={() => setHelpfulFilter('helpful')}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                helpfulFilter === 'helpful'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  : 'border-[var(--border-muted)] bg-[var(--surface-subtle)] text-[var(--text-muted)]'
              )}
            >
              Helpful only
            </button>
            <button
              type="button"
              onClick={() => setHelpfulFilter('not_helpful')}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                helpfulFilter === 'not_helpful'
                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                  : 'border-[var(--border-muted)] bg-[var(--surface-subtle)] text-[var(--text-muted)]'
              )}
            >
              Not helpful only
            </button>
          </div>

          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setIncludeChatDumps(false)}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                !includeChatDumps
                  ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                  : 'border-[var(--border-muted)] bg-[var(--surface-subtle)] text-[var(--text-muted)]'
              )}
            >
              Exclude chat dumps
            </button>
            <button
              type="button"
              onClick={() => setIncludeChatDumps(true)}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                includeChatDumps
                  ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                  : 'border-[var(--border-muted)] bg-[var(--surface-subtle)] text-[var(--text-muted)]'
              )}
            >
              Include chat dumps
            </button>
          </div>

          <select
            value={nodeFilter}
            onChange={event => setNodeFilter(event.target.value)}
            disabled={!activeContextId || contextNodes.length === 0}
            className="h-9 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
          >
            <option value="">
              {!activeContextId
                ? 'Select an active context to filter by node'
                : contextNodes.length === 0
                  ? 'No nodes in active context'
                  : 'All nodes'}
            </option>
            {contextNodes.map(node => (
              <option key={node.id} value={node.id}>
                {`${NODE_TYPE_META[asNodeType(node.type)].label}: ${compactText(node.content, 58)} (${node.id.slice(0, 8)})`}
              </option>
            ))}
          </select>
        </div>

        <p className="text-xs text-[var(--text-muted)]">
          Context: {scope === 'active' ? (activeContext?.name ?? 'No active context') : 'All contexts'}
        </p>
      </Panel>

      {!activeContextId && scope === 'active' && (
        <Panel className="flex items-center gap-2 p-3 text-xs text-[var(--text-muted)]">
          <AlertTriangle className="h-3.5 w-3.5" />
          Select an active context or switch scope to all contexts.
        </Panel>
      )}

      {error && (
        <Panel className="border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-xs text-[var(--danger-fg)]">
          {error}
        </Panel>
      )}

      <Panel className="space-y-3 p-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">7-day feedback trend</h3>
        <div className="space-y-2">
          {trend.map(bucket => {
            const helpfulWidth = bucket.total > 0 ? (bucket.helpful / bucket.total) * 100 : 0;
            const notHelpfulWidth = bucket.total > 0 ? (bucket.notHelpful / bucket.total) * 100 : 0;
            return (
              <div key={bucket.key} className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-[var(--text-secondary)]">{bucket.label}</span>
                  <span className="text-[var(--text-muted)]">
                    {bucket.total} total ({bucket.helpful} helpful / {bucket.notHelpful} not helpful)
                  </span>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-[var(--surface-raised)]">
                  <div className="bg-emerald-500/70" style={{ width: `${helpfulWidth}%` }} />
                  <div className="bg-rose-500/70" style={{ width: `${notHelpfulWidth}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="space-y-2 p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Top improved nodes</h3>
          {topImproved.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No feedback data yet.</p>
          ) : (
            topImproved.map(stat => {
              const node = nodeMap.get(stat.nodeId);
              return (
                <div key={stat.nodeId} className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2">
                  <p className="text-sm text-[var(--text-primary)]">
                    {node ? compactText(node.content) : stat.nodeId}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    net: <span className={cn(stat.netScore >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{stat.netScore >= 0 ? `+${stat.netScore}` : stat.netScore}</span>
                    {' '}| helpful: {stat.helpful} | not helpful: {stat.notHelpful}
                  </p>
                </div>
              );
            })
          )}
        </Panel>

        <Panel className="space-y-2 p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Needs attention</h3>
          {needsAttention.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No feedback data yet.</p>
          ) : (
            needsAttention.map(stat => {
              const node = nodeMap.get(stat.nodeId);
              return (
                <div key={stat.nodeId} className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2">
                  <p className="text-sm text-[var(--text-primary)]">
                    {node ? compactText(node.content) : stat.nodeId}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    net: <span className={cn(stat.netScore >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{stat.netScore >= 0 ? `+${stat.netScore}` : stat.netScore}</span>
                    {' '}| helpful: {stat.helpful} | not helpful: {stat.notHelpful}
                  </p>
                </div>
              );
            })
          )}
        </Panel>
      </div>

      <Panel className="space-y-2 p-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Recent feedback</h3>
        {recentItems.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">No recall feedback recorded yet.</p>
        ) : (
          recentItems.map(item => {
            const node = nodeMap.get(item.nodeId);
            return (
              <div key={`${item.nodeId}-${item.createdAt ?? 0}-${item.helpful ? 'h' : 'n'}`} className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-[var(--text-primary)]">{node ? compactText(node.content, 92) : item.nodeId}</p>
                  <span className="text-xs text-[var(--text-muted)]">
                    {typeof item.createdAt === 'number' ? formatTimestamp(item.createdAt) : 'n/a'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {item.helpful ? (
                    <span className="inline-flex items-center gap-1 text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Helpful
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-rose-300">
                      <XCircle className="h-3.5 w-3.5" />
                      Not helpful
                    </span>
                  )}
                  {' '}| node: {item.nodeId}
                  {item.reason ? ` | reason: ${item.reason}` : ''}
                </p>
              </div>
            );
          })
        )}
      </Panel>
    </div>
  );
}
