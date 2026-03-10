import { Loader2, RefreshCw, Terminal } from 'lucide-react';
import type { HookHealthSnapshot } from '@/app/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { SubtlePanel } from '@/components/dashboard/settings/shared';

export function HookHealthPanel({ hooksLoading, hookHealth, onRefresh }: { hooksLoading: boolean; hookHealth: HookHealthSnapshot | null; onRefresh: () => void }) {
  return (
    <Panel className="space-y-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-[var(--text-muted)]" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Setup + Hook Health</p>
        </div>
        <Button variant="secondary" size="sm" disabled={hooksLoading} onClick={onRefresh}>
          {hooksLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {!hookHealth ? (
        <p className="text-xs text-[var(--text-muted)]">No hook health state found yet. Run <span className="font-mono">0ctx setup</span> or <span className="font-mono">0ctx connector hook install</span>.</p>
      ) : (
        <div className="space-y-2">
          {hookHealth.agents.map((agent) => (
            <div key={agent.agent} className="flex items-center justify-between rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2 text-xs">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">{agent.agent}</p>
                <p className="text-[var(--text-muted)]">{agent.notes ?? 'status'}</p>
              </div>
              <Badge muted={agent.status !== 'Supported'}>{agent.status}{agent.installed ? ' • Installed' : ''}</Badge>
            </div>
          ))}
          <SubtlePanel>
            <p>State file: <span className="font-mono">{hookHealth.statePath || '-'}</span></p>
            <p>Project config: <span className="font-mono">{hookHealth.projectConfigPath ?? '-'}</span></p>
          </SubtlePanel>
        </div>
      )}
    </Panel>
  );
}
