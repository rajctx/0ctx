import { Gauge, Loader2, RefreshCw, Save, Workflow } from 'lucide-react';
import type { CompletionEvaluation, SyncPolicy } from '@/app/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { Row, SubtlePanel } from '@/components/dashboard/settings/shared';

export function RuntimePolicyPanel({
  activeContextId,
  activeContextName,
  completion,
  completionLoading,
  completionReason,
  syncPolicy,
  syncPolicyDraft,
  syncPolicyBusy,
  syncPolicyOptions,
  canSavePolicy,
  runtimeError,
  runtimeInfo,
  onRefresh,
  onSyncPolicyChange,
  onSavePolicy,
}: {
  activeContextId: string | null;
  activeContextName: string | null;
  completion: CompletionEvaluation | null;
  completionLoading: boolean;
  completionReason: string | null;
  syncPolicy: SyncPolicy | null;
  syncPolicyDraft: SyncPolicy;
  syncPolicyBusy: boolean;
  syncPolicyOptions: SyncPolicy[];
  canSavePolicy: boolean;
  runtimeError: string | null;
  runtimeInfo: string | null;
  onRefresh: () => void;
  onSyncPolicyChange: (value: SyncPolicy) => void;
  onSavePolicy: () => void;
}) {
  return (
    <Panel className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-[var(--text-muted)]" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Context Completion + Sync Policy</p>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Context: {activeContextName ?? 'No active context selected'}</p>
        </div>
        <Button variant="secondary" size="sm" disabled={!activeContextId || completionLoading} onClick={onRefresh}>
          {completionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh Runtime
        </Button>
      </div>

      {!activeContextId && <SubtlePanel>Select a context from the sidebar to manage completion and sync policy.</SubtlePanel>}

      {activeContextId && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel className="space-y-3 p-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Completion Evaluator</p>
              <Badge muted={!completion?.complete}>{completion ? (completion.complete ? 'Complete' : 'Incomplete') : 'Unknown'}</Badge>
            </div>
            {completion ? (
              <div className="space-y-2 text-xs text-[var(--text-secondary)]">
                <Row label="Open gates" value={String(completion.openGates.length)} />
                <Row label="Active leases" value={String(completion.activeLeases.length)} />
                <Row label="Blocking events" value={String(completion.recentBlockingEvents.length)} />
                <Row label="Cooldown" value={`${completion.stabilizationCooldownMs}ms`} />
                <Row label="Evaluated" value={new Date(completion.evaluatedAt).toLocaleString()} />
                {completionReason && <SubtlePanel>{completionReason}</SubtlePanel>}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">No completion snapshot loaded yet.</p>
            )}
          </Panel>

          <Panel className="space-y-3 p-3">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-[var(--text-muted)]" />
              <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Sync Policy</p>
            </div>
            <select
              value={syncPolicyDraft}
              onChange={(event) => onSyncPolicyChange(event.target.value as SyncPolicy)}
              disabled={!activeContextId || syncPolicyBusy}
              className="h-9 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus-ring)]"
            >
              {syncPolicyOptions.map((policy) => <option key={policy} value={policy}>{policy}</option>)}
            </select>
            <div className="text-xs text-[var(--text-muted)]">Current: <span className="font-semibold text-[var(--text-primary)]">{syncPolicy ?? '-'}</span></div>
            <Button variant="primary" size="sm" disabled={!canSavePolicy} onClick={onSavePolicy}>
              {syncPolicyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Policy
            </Button>
          </Panel>
        </div>
      )}

      {runtimeError && <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger-fg)]">{runtimeError}</div>}
      {runtimeInfo && <div className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--accent-text)]">{runtimeInfo}</div>}
    </Panel>
  );
}
