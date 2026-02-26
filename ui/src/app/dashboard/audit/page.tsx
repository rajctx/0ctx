'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, History, Loader2, RefreshCw } from 'lucide-react';
import { AuditEventEntry, listAuditEventsAction } from '@/app/actions';
import { useDashboardState } from '@/components/dashboard/dashboard-state-provider';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { cn, formatTimestamp } from '@/lib/ui';

export default function DashboardAuditPage() {
  const { activeContextId } = useDashboardState();
  const [auditScope, setAuditScope] = useState<'active' | 'all'>('active');
  const [auditEvents, setAuditEvents] = useState<AuditEventEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshAudit = useCallback(async () => {
    setLoading(true);
    try {
      const contextId = auditScope === 'active' ? activeContextId : null;
      const events = await listAuditEventsAction(contextId, 40);
      setAuditEvents(events);
    } finally {
      setLoading(false);
    }
  }, [activeContextId, auditScope]);

  useEffect(() => {
    void refreshAudit();
  }, [refreshAudit]);

  return (
    <div className="space-y-4 p-3 md:p-4">
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
          <Button variant="secondary" size="sm" onClick={refreshAudit} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        {auditEvents.length === 0 ? (
          <Panel className="flex items-center gap-2 p-3 text-xs text-[var(--text-muted)]">
            <AlertTriangle className="h-3.5 w-3.5" />
            No audit events for this scope yet.
          </Panel>
        ) : (
          auditEvents.map(event => (
            <Panel key={event.id} className="space-y-1 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-[var(--text-primary)]">{event.action}</p>
                <span className="text-xs text-[var(--text-muted)]">{formatTimestamp(event.createdAt)}</span>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                context: {event.contextId ?? 'n/a'} | source: {event.source ?? 'daemon'}
              </p>
            </Panel>
          ))
        )}
      </div>
    </div>
  );
}
