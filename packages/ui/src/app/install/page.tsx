'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Loader2,
  Network,
  RefreshCw,
  XCircle
} from 'lucide-react';
import { getRuntimeStatus } from '@/app/actions';
import type { RuntimeStatusSnapshot } from '@/app/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';

type StepStatus = 'todo' | 'in_progress' | 'blocked' | 'done';

interface OnboardingStep {
  id: string;
  label: string;
  description: string;
  status: StepStatus;
  message: string;
  action?: string;
}

const POLL_INTERVAL_MS = 8_000;

function resolveSteps(status: RuntimeStatusSnapshot | null): OnboardingStep[] {
  const cloudOk = status?.cloudConnected ?? false;
  const bridgeOk = status?.bridgeHealthy ?? false;
  const caps = status?.capabilities ?? [];

  return [
    {
      id: 'cli',
      label: 'Install CLI',
      description: 'CLI installed and callable.',
      status: 'done',
      message: 'Run: npm install -g @0ctx/cli'
    },
    {
      id: 'auth',
      label: 'Authenticate',
      description: 'Valid user session for hosted UI.',
      status: status ? 'done' : 'blocked',
      message: status ? 'Session active.' : 'Sign in to continue.',
      action: status ? undefined : '/login'
    },
    {
      id: 'connector',
      label: 'Connector Registered',
      description: 'Machine registration exists in control plane.',
      status: bridgeOk ? 'done' : status ? 'blocked' : 'todo',
      message: bridgeOk
        ? 'Connector registered.'
        : 'Run: 0ctx connector register --require-cloud'
    },
    {
      id: 'bridge',
      label: 'Bridge Healthy',
      description: 'Connector bridge can execute runtime actions.',
      status: bridgeOk ? 'done' : 'blocked',
      message: bridgeOk ? 'Bridge healthy.' : 'Waiting for connector bridge.'
    },
    {
      id: 'mcp',
      label: 'MCP Clients Detected',
      description: 'Supported client integration state detected.',
      status: caps.length > 0 ? 'done' : bridgeOk ? 'in_progress' : 'todo',
      message:
        caps.length > 0
          ? `Capabilities: ${caps.join(', ')}`
          : 'Run: 0ctx bootstrap --clients=all'
    },
    {
      id: 'context',
      label: 'First Context Created',
      description: 'Active context exists and is selectable.',
      status: cloudOk && bridgeOk ? 'done' : 'todo',
      message:
        cloudOk && bridgeOk
          ? 'Ready — proceed to dashboard.'
          : 'Create a context from the dashboard.'
    }
  ];
}

function statusIcon(status: StepStatus) {
  switch (status) {
    case 'done':
      return <CheckCircle2 className="h-5 w-5 text-emerald-400" />;
    case 'in_progress':
      return <Loader2 className="h-5 w-5 animate-spin text-amber-300" />;
    case 'blocked':
      return <XCircle className="h-5 w-5 text-rose-400" />;
    default:
      return <Circle className="h-5 w-5 text-[var(--text-muted)]" />;
  }
}

export default function InstallPage() {
  const router = useRouter();
  const [status, setStatus] = useState<RuntimeStatusSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const snapshot = await getRuntimeStatus();
      setStatus(snapshot);
      setLastCheckedAt(Date.now());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const steps = resolveSteps(status);
  const allDone = steps.every(step => step.status === 'done');
  const doneCount = steps.filter(step => step.status === 'done').length;

  return (
    <main className="min-h-screen text-[var(--text-primary)]">
      <header className="sticky top-0 z-40 border-b border-[var(--border-muted)] bg-[var(--surface-overlay)]/92 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[900px] items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface-subtle)]">
              <Network className="h-4 w-4 text-[var(--accent-strong)]" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">0ctx</p>
              <p className="text-sm font-semibold">Setup</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
            {allDone && (
              <Button variant="primary" size="sm" onClick={() => router.push('/dashboard/workspace')}>
                Open Dashboard
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[900px] space-y-6 px-4 pb-16 pt-8">
        <div>
          <Badge>{doneCount}/{steps.length} steps complete</Badge>
          <h1 className="mt-2 text-2xl font-semibold">Onboarding Checklist</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Complete each step to connect your local runtime to the hosted dashboard.
            {lastCheckedAt && (
              <span className="ml-2">Last checked {new Date(lastCheckedAt).toLocaleTimeString()}</span>
            )}
          </p>
        </div>

        <div className="space-y-3">
          {steps.map((step, index) => (
            <Panel key={step.id} className="flex items-start gap-4 p-4">
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs font-bold text-[var(--text-muted)]">{index + 1}</span>
                {statusIcon(step.status)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{step.label}</p>
                  <Badge muted={step.status !== 'done'}>{step.status}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">{step.description}</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">{step.message}</p>
                {step.action && (
                  <Link href={step.action} className="mt-2 inline-block text-xs font-medium text-[var(--accent-text)] hover:underline">
                    {step.action === '/login' ? 'Sign in →' : 'Fix →'}
                  </Link>
                )}
              </div>
            </Panel>
          ))}
        </div>

        {allDone && (
          <Panel className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm font-semibold text-emerald-300">Setup complete</p>
              <p className="text-xs text-[var(--text-muted)]">All onboarding steps passed. You can now use the dashboard.</p>
            </div>
            <Button variant="primary" size="lg" onClick={() => router.push('/dashboard/workspace')}>
              Open Dashboard
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Panel>
        )}
      </div>
    </main>
  );
}
