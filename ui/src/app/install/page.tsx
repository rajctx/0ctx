'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Loader2,
  Network,
  RefreshCw,
  TerminalSquare
} from 'lucide-react';
import { getRuntimeStatus } from '@/app/actions';
import type { RuntimeStatusSnapshot } from '@/app/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';

type StepTone = 'done' | 'active' | 'pending';

interface ReadinessStep {
  id: string;
  label: string;
  description: string;
  command?: string;
  tone: StepTone;
}

const POLL_INTERVAL_MS = 8_000;

function statusIcon(tone: StepTone) {
  switch (tone) {
    case 'done':
      return <CheckCircle2 className="h-5 w-5 text-emerald-400" />;
    case 'active':
      return <Loader2 className="h-5 w-5 animate-spin text-amber-300" />;
    default:
      return <Circle className="h-5 w-5 text-[var(--text-muted)]" />;
  }
}

function resolveSteps(status: RuntimeStatusSnapshot | null): ReadinessStep[] {
  const cloudOk = status?.cloudConnected ?? false;
  const bridgeOk = status?.bridgeHealthy ?? false;

  return [
    {
      id: 'cli',
      label: 'Install the CLI',
      description: 'Use the npm package or your local build so `0ctx` is callable inside a repo.',
      command: 'npm install -g @0ctx/cli',
      tone: 'done'
    },
    {
      id: 'auth',
      label: 'Sign in on this machine',
      description: 'Hosted access is optional for local-only work, but needed for account and download features.',
      command: '0ctx auth login',
      tone: cloudOk ? 'done' : 'pending'
    },
    {
      id: 'runtime',
      label: 'Make sure the local runtime is reachable',
      description: '0ctx should be able to talk to the daemon and connector bridge on this machine.',
      command: '0ctx status',
      tone: bridgeOk ? 'done' : status ? 'active' : 'pending'
    },
    {
      id: 'enable',
      label: 'Enable one repo',
      description: 'From inside the repository you actually work in, bind the repo and install supported integrations.',
      command: 'cd <repo>\n0ctx enable',
      tone: bridgeOk ? 'active' : 'pending'
    }
  ];
}

function readinessHeadline(status: RuntimeStatusSnapshot | null) {
  if (!status) {
    return 'Checking local runtime status...';
  }
  if (status.bridgeHealthy) {
    return 'Machine is ready for repo-first enablement.';
  }
  if (status.cloudConnected) {
    return 'Account is connected. Finish local runtime setup, then enable your repo.';
  }
  return 'Use the CLI in a repo to complete setup.';
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

  const steps = useMemo(() => resolveSteps(status), [status]);
  const doneCount = steps.filter((step) => step.tone === 'done').length;
  const bridgeOk = status?.bridgeHealthy ?? false;
  const cloudOk = status?.cloudConnected ?? false;

  return (
    <main className="min-h-screen text-[var(--text-primary)]">
      <header className="sticky top-0 z-40 border-b border-[var(--border-muted)] bg-[var(--surface-overlay)]/92 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[960px] items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface-subtle)]">
              <Network className="h-4 w-4 text-[var(--accent-strong)]" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">0ctx</p>
              <p className="text-sm font-semibold">Machine readiness</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
            <Button variant="primary" size="sm" onClick={() => router.push('/dashboard/settings')}>
              Open account
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[960px] space-y-6 px-4 pb-16 pt-8">
        <div className="space-y-3">
          <Badge>{doneCount}/{steps.length} machine steps complete</Badge>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Enable one repository, then work normally</h1>
            <p className="text-sm text-[var(--text-muted)]">
              0ctx is repo-first. The normal path is:
              <span className="ml-2 font-mono text-[var(--text-secondary)]">cd &lt;repo&gt; && 0ctx enable</span>
            </p>
            <p className="text-sm text-[var(--text-secondary)]">
              {readinessHeadline(status)}
              {lastCheckedAt && <span className="ml-2">Last checked {new Date(lastCheckedAt).toLocaleTimeString()}</span>}
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Panel className="space-y-3 p-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Normal path</p>
              <h2 className="mt-1 text-lg font-semibold">Machine readiness checklist</h2>
            </div>
            <div className="space-y-3">
              {steps.map((step, index) => (
                <div key={step.id} className="flex items-start gap-4 rounded-xl border border-[var(--border-muted)] bg-[var(--surface-subtle)]/50 p-4">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-xs font-bold text-[var(--text-muted)]">{index + 1}</span>
                    {statusIcon(step.tone)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{step.label}</p>
                      <Badge muted={step.tone !== 'done'}>
                        {step.tone === 'done' ? 'done' : step.tone === 'active' ? 'in progress' : 'pending'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">{step.description}</p>
                    {step.command && (
                      <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--border-muted)] bg-[var(--surface-overlay)] p-3">
                        <TerminalSquare className="mt-0.5 h-4 w-4 text-[var(--text-muted)]" />
                        <pre className="overflow-x-auto text-xs text-[var(--text-secondary)]">{step.command}</pre>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <div className="space-y-6">
            <Panel className="space-y-4 p-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">What happens</p>
                <h2 className="mt-1 text-lg font-semibold">After `0ctx enable`</h2>
              </div>
              <ul className="space-y-3 text-sm text-[var(--text-secondary)]">
                <li>0ctx binds the current repo to a workspace.</li>
                <li>It starts or verifies the local daemon.</li>
                <li>It installs supported capture and context integrations for GA agents.</li>
                <li>Daily work should then happen in the agent and repo, not in this page.</li>
              </ul>
            </Panel>

            <Panel className="space-y-4 p-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Current machine state</p>
                <h2 className="mt-1 text-lg font-semibold">Runtime snapshot</h2>
              </div>
              <div className="space-y-3 text-sm text-[var(--text-secondary)]">
                <div className="flex items-center justify-between gap-3">
                  <span>Hosted access</span>
                  <Badge muted={!cloudOk}>{cloudOk ? 'connected' : 'not connected'}</Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Local runtime</span>
                  <Badge muted={!bridgeOk}>{bridgeOk ? 'reachable' : 'needs setup'}</Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Capabilities visible</span>
                  <Badge muted={!status?.capabilities?.length}>{status?.capabilities?.length ? `${status.capabilities.length} methods` : 'not yet'}</Badge>
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                This page is for machine readiness only. Daily repo work should happen from the enabled repository in the supported agent.
              </p>
            </Panel>
          </div>
        </div>
      </div>
    </main>
  );
}
