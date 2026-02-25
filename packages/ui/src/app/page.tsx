import Link from 'next/link';
import { ArrowRight, Database, Lock, Network, ScanSearch, Workflow } from 'lucide-react';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';

const highlights = [
  {
    title: 'Persistent Decision Memory',
    description:
      'Store goals, assumptions, constraints, and decisions in a durable local graph shared across AI tools.',
    icon: Workflow
  },
  {
    title: 'MCP-native Context Access',
    description:
      'Expose your context engine through MCP so assistants can query and reason over real project state.',
    icon: Network
  },
  {
    title: 'Local-first Security Posture',
    description:
      'SQLite-first architecture keeps source-of-truth on your machine with backup and encryption support.',
    icon: Lock
  }
];

export default function HomePage() {
  return (
    <main className="min-h-screen text-[var(--text-primary)]">
      <header className="sticky top-0 z-40 border-b border-[var(--border-muted)] bg-[var(--surface-overlay)]/92 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1300px] items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-3">
            <div className="glass-layer flex h-9 w-9 items-center justify-center rounded-xl">
              <Network className="h-4 w-4 text-[var(--accent-strong)]" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">0ctx</p>
              <p className="text-sm font-semibold">Context Engine</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle compact />
            <Link href="/docs">
              <Button variant="secondary" size="sm" className="hidden sm:inline-flex">
                Docs
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="primary" size="sm">
                Open Dashboard
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-[1300px] gap-8 px-4 pb-10 pt-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="space-y-6 ui-rise-in">
          <Badge>Enterprise-ready local context orchestration</Badge>
          <h1 className="max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl">
            Keep AI workflows grounded in a shared, living context graph.
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
            0ctx eliminates context drift between tools by storing your decisions, constraints, goals, and
            artifacts in a local-first graph. Teams get consistency, traceability, and operational confidence.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/dashboard">
              <Button variant="primary" size="lg">
                Launch local workspace
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <a href="https://github.com/0ctx-com/0ctx#architecture" target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" size="lg">
                <ScanSearch className="h-4 w-4" />
                See architecture
              </Button>
            </a>
          </div>
          <div className="grid max-w-xl grid-cols-3 gap-3 pt-2">
            <Metric label="Node Queries" value="<50ms" />
            <Metric label="Deployment" value="Local-first" />
            <Metric label="Protocol" value="MCP Native" />
          </div>
        </div>

        <Panel className="overflow-hidden p-6 ui-rise-in ui-delay-1">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.13em] text-[var(--text-muted)]">Live Context Stream</p>
              <Badge muted>Active</Badge>
            </div>
            <Panel className="space-y-3 p-4">
              <Row label="Current Workspace" value="Product Reliability Program" />
              <Row label="Selected Node Type" value="Decision" />
              <Row label="Connected Methods" value="31" />
            </Panel>

            <Panel className="space-y-2 p-4">
              <p className="text-sm font-semibold">Latest Decision Snapshot</p>
              <p className="text-sm text-[var(--text-secondary)]">
                Prioritize deterministic context retrieval and active checkpointing before expanding autonomous flows.
              </p>
              <div className="pt-2 text-xs text-[var(--text-muted)]">Updated 2 minutes ago</div>
            </Panel>
          </div>
        </Panel>
      </section>

      <section className="mx-auto w-full max-w-[1300px] px-4 pb-16 pt-8">
        <div className="grid gap-4 md:grid-cols-3">
          {highlights.map((item, index) => (
            <Panel key={item.title} className={`p-5 ui-rise-in ui-delay-${index + 1}`}>
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                <item.icon className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold">{item.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{item.description}</p>
            </Panel>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1300px] px-4 pb-20">
        <Panel className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.13em] text-[var(--text-muted)]">Ready to standardize context?</p>
            <h3 className="mt-2 text-2xl font-semibold">Move from context copy-paste to context infrastructure.</h3>
          </div>
          <div className="flex gap-3">
            <Link href="/dashboard">
              <Button variant="primary" size="lg">
                Open dashboard
              </Button>
            </Link>
            <a href="https://github.com/0ctx-com/0ctx/blob/main/docs/ARCHITECTURE.md" target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" size="lg">
                <Database className="h-4 w-4" />
                Data model
              </Button>
            </a>
          </div>
        </Panel>
      </section>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <span className="text-sm font-medium text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Panel className="px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{value}</p>
    </Panel>
  );
}
