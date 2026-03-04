'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, History, Loader2, RefreshCw, XCircle } from 'lucide-react';
import {
  AuditEventEntry,
  getGraphData,
  listAuditEventsAction,
  listRecallFeedbackAction,
  RecallFeedbackSummary,
  submitRecallFeedbackAction
} from '@/app/actions';
import { useDashboardState } from '@/components/dashboard/dashboard-state-provider';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { asNodeType, GraphNode, NODE_TYPE_META } from '@/lib/graph';
import { cn, formatTimestamp } from '@/lib/ui';

function parseRecallFeedbackEntry(event: AuditEventEntry): {
  nodeId: string | null;
  helpful: boolean | null;
  reason: string | null;
} {
  const payload = event.payload ?? {};
  const payloadParams = payload && typeof payload.params === 'object'
    ? payload.params as Record<string, unknown>
    : payload;
  const nodeId = typeof payloadParams.nodeId === 'string' ? payloadParams.nodeId : null;
  const helpful = typeof payloadParams.helpful === 'boolean' ? payloadParams.helpful : null;
  const reason = typeof payloadParams.reason === 'string' ? payloadParams.reason : null;
  return { nodeId, helpful, reason };
}

function compactText(value: string, maxLength = 64): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

export default function DashboardAuditPage() {
  const { activeContextId } = useDashboardState();
  const [auditScope, setAuditScope] = useState<'active' | 'all'>('active');
  const [eventFilter, setEventFilter] = useState<'all' | 'feedback'>('all');
  const [auditEvents, setAuditEvents] = useState<AuditEventEntry[]>([]);
  const [contextNodes, setContextNodes] = useState<GraphNode[]>([]);
  const [feedbackSummary, setFeedbackSummary] = useState<RecallFeedbackSummary | null>(null);
  const [feedbackNodeId, setFeedbackNodeId] = useState('');
  const [feedbackReason, setFeedbackReason] = useState('');
  const [feedbackHelpful, setFeedbackHelpful] = useState(true);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  const refreshAudit = useCallback(async () => {
    setLoading(true);
    if (activeContextId) {
      setNodesLoading(true);
    }
    try {
      if (auditScope === 'active' && !activeContextId) {
        setAuditEvents([]);
        setFeedbackSummary(null);
        setContextNodes([]);
        setFeedbackNodeId('');
        return;
      }
      const contextId = auditScope === 'active' ? activeContextId : null;
      const [events, feedback, graph] = await Promise.all([
        listAuditEventsAction(contextId, 80),
        listRecallFeedbackAction({ contextId, limit: 80 }),
        activeContextId ? getGraphData(activeContextId) : Promise.resolve({ nodes: [], edges: [] })
      ]);
      setAuditEvents(events);
      setFeedbackSummary(feedback);
      const nextNodes = [...(graph?.nodes ?? [])].sort((a, b) => b.createdAt - a.createdAt);
      setContextNodes(nextNodes);
      setFeedbackNodeId(current =>
        current && nextNodes.some(node => node.id === current) ? current : ''
      );
    } finally {
      setNodesLoading(false);
      setLoading(false);
    }
  }, [activeContextId, auditScope]);

  useEffect(() => {
    void refreshAudit();
  }, [refreshAudit]);

  const selectedNode = useMemo(
    () => contextNodes.find(node => node.id === feedbackNodeId) ?? null,
    [contextNodes, feedbackNodeId]
  );

  const nodeLabelMap = useMemo(() => {
    return new Map(contextNodes.map(node => [node.id, compactText(node.content, 70)]));
  }, [contextNodes]);

  const visibleEvents = eventFilter === 'feedback'
    ? auditEvents.filter(event => event.action === 'recall_feedback')
    : auditEvents;

  return (
    <div className="space-y-4 p-3 md:p-4">
      <Panel className="space-y-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Recall Feedback</h2>
          </div>
          <div className="flex gap-1 text-xs">
            <span className="rounded-md border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-2 py-1 text-[var(--text-muted)]">
              total: {feedbackSummary?.total ?? 0}
            </span>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-300">
              helpful: {feedbackSummary?.helpfulCount ?? 0}
            </span>
            <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-rose-300">
              not helpful: {feedbackSummary?.notHelpfulCount ?? 0}
            </span>
          </div>
        </div>

        <form
          className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto]"
          onSubmit={async event => {
            event.preventDefault();
            const nodeId = feedbackNodeId;
            if (!nodeId) {
              setFeedbackError('Select a node to submit feedback.');
              return;
            }
            setFeedbackBusy(true);
            setFeedbackError(null);
            try {
              const result = await submitRecallFeedbackAction({
                nodeId,
                helpful: feedbackHelpful,
                reason: feedbackReason,
                contextId: activeContextId ?? undefined
              });
              if (!result?.ok) {
                setFeedbackError('Failed to submit feedback to daemon.');
                return;
              }
              setFeedbackReason('');
              await refreshAudit();
            } finally {
              setFeedbackBusy(false);
            }
          }}
        >
          <select
            value={feedbackNodeId}
            onChange={event => setFeedbackNodeId(event.target.value)}
            disabled={!activeContextId || nodesLoading || contextNodes.length === 0}
            className="h-9 rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
          >
            <option value="">
              {nodesLoading
                ? 'Loading nodes...'
                : !activeContextId
                  ? 'Select an active context first'
                  : contextNodes.length === 0
                    ? 'No nodes in active context'
                    : 'Select node'}
            </option>
            {contextNodes.map(node => (
              <option key={node.id} value={node.id}>
                {`${NODE_TYPE_META[asNodeType(node.type)].label}: ${compactText(node.content)} (${node.id.slice(0, 8)})`}
              </option>
            ))}
          </select>
          <input
            value={feedbackReason}
            onChange={event => setFeedbackReason(event.target.value)}
            placeholder="Reason (optional)"
            className="h-9 rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
          />
          <button
            type="button"
            onClick={() => setFeedbackHelpful(current => !current)}
            className={cn(
              'h-9 rounded-lg border px-3 text-xs font-medium',
              feedbackHelpful
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
            )}
          >
            {feedbackHelpful ? 'Helpful' : 'Not helpful'}
          </button>
          <Button size="sm" variant="secondary" disabled={feedbackBusy}>
            {feedbackBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Submit
          </Button>
        </form>
        {feedbackError && (
          <p className="text-xs text-rose-300">{feedbackError}</p>
        )}
        {selectedNode && (
          <p className="text-xs text-[var(--text-muted)]">
            Selected node: {compactText(selectedNode.content, 90)} ({selectedNode.id})
          </p>
        )}
        {!activeContextId && auditScope === 'active' && (
          <p className="text-xs text-[var(--text-muted)]">
            Select an active context to submit scoped feedback.
          </p>
        )}
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-[var(--text-muted)]" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Audit Events</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setAuditScope('active')}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                auditScope === 'active'
                  ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                  : 'border-[var(--border-muted)] bg-[var(--surface-subtle)] text-[var(--text-muted)]'
              )}
            >
              Active context
            </button>
            <button
              type="button"
              onClick={() => setAuditScope('all')}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                auditScope === 'all'
                  ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                  : 'border-[var(--border-muted)] bg-[var(--surface-subtle)] text-[var(--text-muted)]'
              )}
                >
              All contexts
            </button>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setEventFilter('all')}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                eventFilter === 'all'
                  ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                  : 'border-[var(--border-muted)] bg-[var(--surface-subtle)] text-[var(--text-muted)]'
              )}
            >
              All events
            </button>
            <button
              type="button"
              onClick={() => setEventFilter('feedback')}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                eventFilter === 'feedback'
                  ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                  : 'border-[var(--border-muted)] bg-[var(--surface-subtle)] text-[var(--text-muted)]'
              )}
            >
              Recall feedback
            </button>
          </div>
          <Button variant="secondary" size="sm" onClick={refreshAudit} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        {visibleEvents.length === 0 ? (
          <Panel className="flex items-center gap-2 p-3 text-xs text-[var(--text-muted)]">
            <AlertTriangle className="h-3.5 w-3.5" />
            No audit events for this scope yet.
          </Panel>
        ) : (
          visibleEvents.map(event => {
            const feedback = event.action === 'recall_feedback'
              ? parseRecallFeedbackEntry(event)
              : null;
            const nodeLabel = feedback?.nodeId ? nodeLabelMap.get(feedback.nodeId) : null;
            return (
            <Panel key={event.id} className="space-y-1 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {event.action === 'recall_feedback'
                    ? feedback?.helpful
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                      : <XCircle className="h-3.5 w-3.5 text-rose-300" />
                    : null}
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {event.action === 'recall_feedback' ? 'Recall feedback' : event.action}
                  </p>
                </div>
                <span className="text-xs text-[var(--text-muted)]">{formatTimestamp(event.createdAt)}</span>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                context: {event.contextId ?? 'n/a'} | source: {event.source ?? 'daemon'}
              </p>
              {feedback && (
                <p className="text-xs text-[var(--text-secondary)]">
                  node: {nodeLabel ? `${nodeLabel} (${feedback.nodeId})` : (feedback.nodeId ?? 'n/a')} | helpful: {String(feedback.helpful)}{feedback.reason ? ` | reason: ${feedback.reason}` : ''}
                </p>
              )}
            </Panel>
          );
          })
        )}
      </div>
    </div>
  );
}
