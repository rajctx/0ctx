import Link from 'next/link';
import { ArrowLeft, BookOpen, Network } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';

const REPO_BASE = 'https://github.com/0ctx-com/0ctx/blob/main';

const SECTIONS = [
  {
    title: 'Start Here',
    items: [
      { label: 'Quickstart', href: `${REPO_BASE}/docs/QUICKSTART.md`, description: 'Fastest path from install to first working setup.' },
      { label: 'Install Guide', href: `${REPO_BASE}/docs/INSTALL.md`, description: 'Full install, setup, troubleshooting, and environment variables.' },
      { label: 'UI User Flows', href: `${REPO_BASE}/docs/UI_USER_FLOWS.md`, description: 'End-to-end hosted UI flows.' },
      { label: 'UI Information Architecture', href: `${REPO_BASE}/docs/UI_INFORMATION_ARCHITECTURE.md`, description: 'Route map and dashboard ownership.' },
      { label: 'Onboarding Spec', href: `${REPO_BASE}/docs/HOSTED_UI_ONBOARDING_SPEC.md`, description: 'Onboarding UX spec and completion criteria.' }
    ]
  },
  {
    title: 'Operate at Scale',
    items: [
      { label: 'UI Deployment Runbook', href: `${REPO_BASE}/docs/DEPLOYMENT_UI.md`, description: 'Hosted UI deployment model and production runbook.' },
      { label: 'Environment Variables', href: `${REPO_BASE}/docs/ENVIRONMENT_VARIABLES.md`, description: 'Canonical runtime env var contract.' },
      { label: 'BFF API Contract', href: `${REPO_BASE}/docs/UI_BFF_API_CONTRACT.md`, description: 'Hosted UI BFF endpoint contracts and error envelopes.' },
      { label: 'SLO & Observability', href: `${REPO_BASE}/docs/OPS_SLO_AND_OBSERVABILITY.md`, description: 'SLO targets, telemetry, alerts, and incident model.' },
      { label: 'Release Guide', href: `${REPO_BASE}/docs/RELEASE.md`, description: 'Release preparation and package publish flow.' }
    ]
  },
  {
    title: 'Architecture',
    items: [
      { label: 'Hosted UI Architecture', href: `${REPO_BASE}/docs/HOSTED_UI_PRODUCT_ARCHITECTURE.md`, description: 'Hosted UI architecture decisions and gaps.' },
      { label: 'Connector Service', href: `${REPO_BASE}/docs/CONNECTOR_SERVICE_ARCHITECTURE.md`, description: 'Connector runtime and bridge model.' },
      { label: 'Storage & Sync', href: `${REPO_BASE}/docs/HYBRID_STORAGE_AND_SYNC_MODEL.md`, description: 'Local/cloud storage and sync policy model.' },
      { label: 'Semantic Blackboard', href: `${REPO_BASE}/docs/SEMANTIC_BLACKBOARD_ARCHITECTURE.md`, description: 'Blackboard runtime and event model.' }
    ]
  }
];

export default function DocsPage() {
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
              <p className="text-sm font-semibold">Documentation</p>
            </div>
          </Link>
          <Link href="/">
            <Badge muted>
              <ArrowLeft className="mr-1 h-3 w-3" />
              Back to home
            </Badge>
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[900px] space-y-8 px-4 pb-16 pt-8">
        <div>
          <Badge>
            <BookOpen className="mr-1 h-3 w-3" />
            Documentation Index
          </Badge>
          <h1 className="mt-2 text-2xl font-semibold">0ctx Documentation</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Product, platform, and operational documentation for 0ctx.
          </p>
        </div>

        {SECTIONS.map(section => (
          <section key={section.title}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">{section.title}</h2>
            <div className="space-y-2">
              {section.items.map(item => (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Panel className="flex items-center justify-between p-3 transition-colors hover:bg-[var(--surface-subtle)]">
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{item.label}</p>
                      <p className="text-xs text-[var(--text-muted)]">{item.description}</p>
                    </div>
                    <ArrowLeft className="h-4 w-4 rotate-180 text-[var(--text-muted)]" />
                  </Panel>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
