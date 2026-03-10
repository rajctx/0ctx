import { Gauge, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { cn } from '@/lib/ui';
import type { ReadinessStep } from '@/components/dashboard/settings/shared';

export function ReadinessPanel({ readinessBusy, readinessSteps, onRunCheck }: { readinessBusy: boolean; readinessSteps: ReadinessStep[]; onRunCheck: () => void }) {
  return (
    <Panel className="space-y-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-[var(--text-muted)]" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Readiness Check</p>
        </div>
        <Button variant="secondary" size="sm" disabled={readinessBusy} onClick={onRunCheck}>
          {readinessBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Run Check
        </Button>
      </div>

      {readinessSteps.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">Run a one-click check for auth, daemon posture, doctor checks, and cloud bridge health.</p>
      ) : (
        <div className="space-y-2">
          {readinessSteps.map((step) => (
            <div
              key={step.id}
              className={cn(
                'rounded-lg border px-3 py-2 text-xs',
                step.status === 'pass'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  : step.status === 'warn'
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
              )}
            >
              <span className="mr-2 uppercase tracking-[0.08em]">{step.id}</span>
              {step.message}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
