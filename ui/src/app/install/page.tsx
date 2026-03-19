import Link from 'next/link';
import {
  CheckCircle2,
  Network,
  TerminalSquare
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';

interface ReadinessStep {
  id: string;
  label: string;
  description: string;
  command?: string;
}

const steps: ReadinessStep[] = [
  {
    id: 'cli',
    label: 'Install the CLI',
    description: 'Use the npm package or your local build so `0ctx` is callable inside a repo.',
    command: 'npm install -g @0ctx/cli'
  },
  {
    id: 'runtime',
    label: 'Check the local runtime',
    description: 'Confirm the local daemon is reachable on this machine before enabling a repo.',
    command: '0ctx status'
  },
  {
    id: 'enable',
    label: 'Enable one repo',
    description: 'From inside the repository you actually work in, bind the repo and install supported integrations.',
    command: 'cd <repo>\n0ctx enable'
  }
];

export default function InstallPage() {
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
        </div>
      </header>

      <div className="mx-auto w-full max-w-[960px] space-y-6 px-4 pb-16 pt-8">
        <div className="space-y-3">
          <Badge>{steps.length} local setup steps</Badge>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Enable one repository, then work normally</h1>
            <p className="text-sm text-[var(--text-muted)]">
              0ctx is repo-first. The normal path is:
              <span className="ml-2 font-mono text-[var(--text-secondary)]">cd &lt;repo&gt; && 0ctx enable</span>
            </p>
            <p className="text-sm text-[var(--text-secondary)]">
              No account or external backend is required for the current product path.
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
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{step.label}</p>
                      <Badge>local</Badge>
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
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Current scope</p>
                <h2 className="mt-1 text-lg font-semibold">Local-first release path</h2>
              </div>
              <div className="space-y-3 text-sm text-[var(--text-secondary)]">
                <div className="flex items-center justify-between gap-3">
                  <span>Public docs</span>
                  <Badge>enabled</Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Account auth</span>
                  <Badge muted>removed</Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>External APIs</span>
                  <Badge muted>removed</Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>External sync</span>
                  <Badge muted>out of scope</Badge>
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                This page is static guidance only. The current release path is local daemon plus repo-bound workflows.
              </p>
            </Panel>
          </div>
        </div>
      </div>
    </main>
  );
}
