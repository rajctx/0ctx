import Link from 'next/link';
import { ArrowLeft, BookOpen, Network } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';

const REPO_BASE = 'https://github.com/rajctx/0ctx/blob/main';

type DocItem = {
  label: string;
  href: string;
  description: string;
  external?: boolean;
};

const SECTIONS = [
  {
    title: 'Start Here',
    items: [
      { label: 'Install Guide', href: '/install', description: 'Machine readiness and the repo-first install path for the current product surface.' },
      { label: 'Quickstart', href: `${REPO_BASE}/docs/QUICKSTART.md`, description: 'Fastest path from install to first working setup.', external: true },
      { label: 'README', href: `${REPO_BASE}/README.md`, description: 'High-level product overview, commands, and architecture.', external: true }
    ] satisfies DocItem[]
  },
  {
    title: 'Product Model',
    items: [
      { label: 'Integrations', href: `${REPO_BASE}/docs/INTEGRATIONS.md`, description: 'GA versus preview agents and how capture/retrieval works.', external: true },
      { label: 'Data Policy', href: `${REPO_BASE}/docs/DATA_POLICY.md`, description: 'Local-first defaults, retention, and sync posture.', external: true },
      { label: 'Documentation Index', href: `${REPO_BASE}/docs/INDEX.md`, description: 'Canonical entrypoint for maintained repo docs.', external: true }
    ] satisfies DocItem[]
  },
  {
    title: 'Operate',
    items: [
      { label: 'Release Guide', href: `${REPO_BASE}/docs/RELEASE.md`, description: 'Release preparation and validation flow for maintainers.', external: true },
      { label: 'GitHub Issues', href: 'https://github.com/rajctx/0ctx/issues', description: 'Report bugs, track work, or follow current issues.', external: true },
      { label: 'Source Repository', href: 'https://github.com/rajctx/0ctx', description: 'Browse the source, scripts, and current documentation set.', external: true }
    ] satisfies DocItem[]
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
        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <Badge>
              <BookOpen className="mr-1 h-3 w-3" />
              Documentation Index
            </Badge>
            <h1 className="mt-2 text-2xl font-semibold">0ctx Documentation</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Public docs, install guidance, and operating references for the current repo-first product path.
            </p>
          </div>

          <Panel className="space-y-2 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Use this site for</p>
            <p className="text-sm text-[var(--text-secondary)]">
              Getting the local runtime running, enabling one repository, and finding the canonical docs that explain the product model.
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              The CLI/runtime remains the primary open-source surface. This UI keeps the docs and install path easy to find.
            </p>
          </Panel>
        </div>

        <div>
          <Badge>
            <BookOpen className="mr-1 h-3 w-3" />
            Public docs
          </Badge>
        </div>

        {SECTIONS.map(section => (
          <section key={section.title}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">{section.title}</h2>
            <div className="space-y-2">
              {section.items.map(item => {
                const content = (
                  <Panel className="flex items-center justify-between p-3 transition-colors hover:bg-[var(--surface-subtle)]">
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{item.label}</p>
                      <p className="text-xs text-[var(--text-muted)]">{item.description}</p>
                    </div>
                    <ArrowLeft className="h-4 w-4 rotate-180 text-[var(--text-muted)]" />
                  </Panel>
                );

                if (item.external) {
                  return (
                    <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer">
                      {content}
                    </a>
                  );
                }

                return (
                  <Link key={item.label} href={item.href}>
                    {content}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
