'use client';

import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Database,
  HelpCircle,
  History,
  LayoutGrid,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, formatTimestamp } from '@/lib/ui';
import { useDashboardState } from '@/components/dashboard/dashboard-state-provider';

const ROUTE_ITEMS = [
  {
    href: '/dashboard/workspace',
    id: 'workspace',
    label: 'Workspace',
    subtitle: 'Graph + Inspector',
    icon: LayoutGrid
  },
  {
    href: '/dashboard/audit',
    id: 'audit',
    label: 'Audit',
    subtitle: 'Audit + Feedback',
    icon: History
  },
  {
    href: '/dashboard/recall',
    id: 'recall',
    label: 'Recall',
    subtitle: 'Trends + Ranking',
    icon: Activity
  },
  {
    href: '/dashboard/backups',
    id: 'backups',
    label: 'Backups',
    subtitle: 'Backup Inventory',
    icon: ShieldCheck
  },
  {
    href: '/dashboard/settings',
    id: 'settings',
    label: 'Settings',
    subtitle: 'Auth + Config',
    icon: Settings2
  }
] as const;

const SUPPORT_ITEMS = [
  { id: 'docs', label: 'Documentation', icon: BookOpen, href: 'https://github.com/0ctx-com/0ctx' },
  { id: 'help', label: 'Help Center', icon: HelpCircle, href: 'https://github.com/0ctx-com/0ctx/issues' }
] as const;

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const {
    contexts,
    activeContext,
    activeContextId,
    setActiveContextId,
    daemonOnline,
    methodCount,
    requestCount,
    connectorPosture,
    connectorRegistered,
    connectorBridgeHealthy,
    connectorCloudConnected,
    lastHealthCheckAt,
    refreshDashboardData,
    createNewContext
  } = useDashboardState();

  const [isCreatingContext, setIsCreatingContext] = useState(false);
  const [newContextName, setNewContextName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const routeMeta = useMemo(
    () =>
      ROUTE_ITEMS.find(item => pathname === item.href || pathname.startsWith(`${item.href}/`)) ??
      ROUTE_ITEMS[0],
    [pathname]
  );

  const handleCreateContext = useCallback(
    async (event?: FormEvent) => {
      if (event) event.preventDefault();
      const name = newContextName.trim();
      if (!name) {
        setIsCreatingContext(false);
        setNewContextName('');
        return;
      }

      setIsCreating(true);
      try {
        await createNewContext(name);
      } finally {
        setIsCreating(false);
        setIsCreatingContext(false);
        setNewContextName('');
      }
    },
    [createNewContext, newContextName]
  );

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-[1900px]">
        <aside className="hidden w-[280px] flex-col border-r border-[var(--border-muted)] lg:flex">
          <div className="border-b border-[var(--border-muted)] px-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-semibold text-[var(--text-primary)] tracking-[0.05em]">0CTX</p>
              </div>
            </div>
          </div>

          <div className="space-y-6 overflow-y-auto px-3 pb-4 pt-4">
            <section>
              <p className="px-2 text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Dashboard</p>
              <nav className="mt-2 space-y-1">
                {ROUTE_ITEMS.map(item => {
                  const selected = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const isWorkspace = item.id === 'workspace';
                  return (
                    <div key={item.id}>
                      <Link
                        href={item.href}
                        className={cn(
                          'flex items-start gap-2 rounded-lg px-2.5 py-2 transition-colors',
                          selected
                            ? 'bg-[var(--surface-subtle)] text-[var(--text-primary)]'
                            : 'text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]'
                        )}
                      >
                        <item.icon className="mt-0.5 h-4 w-4" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{item.label}</span>
                          <span className="block truncate text-[11px] text-[var(--text-muted)]">
                            {item.subtitle}
                          </span>
                        </span>
                        {isWorkspace && (
                          <span className="mt-0.5">
                            {selected ? (
                              <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                            )}
                          </span>
                        )}
                      </Link>

                      {/* Context sub-sidebar nested under Workspace */}
                      {isWorkspace && selected && (
                        <div className="ml-6 mt-1 space-y-1 border-l border-[var(--border-muted)] pl-2">
                          <div className="flex items-center justify-between px-1 py-1">
                            <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                              Contexts
                            </span>
                            <span className="text-[10px] text-[var(--text-muted)]">{contexts.length}</span>
                          </div>
                          <div className="max-h-48 space-y-0.5 overflow-y-auto">
                            {contexts.map(context => (
                              <button
                                key={context.id}
                                type="button"
                                onClick={() => setActiveContextId(context.id)}
                                className={cn(
                                  'w-full rounded-md border px-2 py-1.5 text-left transition-colors',
                                  activeContextId === context.id
                                    ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]'
                                    : 'border-transparent text-[var(--text-muted)] hover:border-[var(--border-muted)] hover:bg-[var(--surface-subtle)]'
                                )}
                              >
                                <p className="truncate text-xs font-medium">{context.name}</p>
                                <p className="text-[10px] text-[var(--text-muted)]">
                                  {formatTimestamp(context.createdAt)}
                                </p>
                              </button>
                            ))}
                          </div>
                          <div className="mt-1">
                            {isCreatingContext ? (
                              <form onSubmit={event => void handleCreateContext(event)}>
                                <input
                                  autoFocus
                                  value={newContextName}
                                  onChange={event => setNewContextName(event.target.value)}
                                  onBlur={() => {
                                    void handleCreateContext();
                                  }}
                                  placeholder="Context name"
                                  className="h-7 w-full rounded-md border border-[var(--border-muted)] bg-[var(--surface-raised)] px-2 text-xs outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                                />
                              </form>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setIsCreatingContext(true)}
                                className="flex h-7 w-full items-center justify-center gap-1 rounded-md border border-dashed border-[var(--border-strong)] text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                              >
                                <Plus className="h-3 w-3" />
                                New context
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>
            </section>

            <section>
              <p className="px-2 text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Support</p>
              <div className="mt-2 space-y-1">
                {SUPPORT_ITEMS.map(item => (
                  <a
                    key={item.id}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]"
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </a>
                ))}
              </div>
            </section>

            <section>
              <div className="mt-2">
                <a
                  href="/auth/logout"
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-[var(--text-muted)] transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </a>
              </div>
            </section>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-[var(--border-muted)] px-4 py-4 md:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.15em] text-[var(--text-muted)]">{routeMeta.label}</p>
                <h1 className="text-xl font-semibold text-[var(--text-primary)]">{activeContext?.name ?? 'No active context'}</h1>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  {lastHealthCheckAt
                    ? `Last synced ${new Date(lastHealthCheckAt).toLocaleTimeString()}`
                    : 'Waiting for daemon status...'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge muted={!daemonOnline}>
                  <span
                    className={cn(
                      'mr-1.5 inline-block h-2 w-2 rounded-full',
                      daemonOnline ? 'bg-emerald-400' : 'bg-rose-500'
                    )}
                  />
                  {daemonOnline ? 'Online' : 'Offline'}
                </Badge>
                <Badge muted>
                  <Database className="mr-1.5 h-3.5 w-3.5" />
                  {methodCount} methods
                </Badge>
                <Badge muted>
                  <Activity className="mr-1.5 h-3.5 w-3.5" />
                  {requestCount ?? '-'} requests
                </Badge>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void refreshDashboardData();
                  }}
                  disabled={isCreating}
                >
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Refresh
                </Button>
              </div>
            </div>
            <nav className="mt-4 flex gap-1 overflow-x-auto pb-1 lg:hidden">
              {ROUTE_ITEMS.map(item => {
                const selected = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                      selected
                        ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                        : 'border-transparent text-[var(--text-muted)] hover:border-[var(--border-muted)] hover:bg-[var(--surface-subtle)]'
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </header>

          <div className="min-h-0 flex-1">{children}</div>
        </section>
      </div>
    </div>
  );
}
