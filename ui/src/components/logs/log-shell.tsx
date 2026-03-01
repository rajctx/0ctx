'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';

const NAV_ITEMS = [
  { href: '/dashboard/logs/activity',   label: 'Activity Feed',  code: '01' },
  { href: '/dashboard/logs/connectors', label: 'Connectors',     code: '02' },
  { href: '/dashboard/logs/commands',   label: 'Command Log',    code: '03' },
  { href: '/dashboard/logs/events',     label: 'Event Ingest',   code: '04' },
  { href: '/dashboard/logs/sync',       label: 'Sync Contexts',  code: '05' },
  { href: '/dashboard/logs/audit',      label: 'Audit Log',      code: '06' },
  { href: '/dashboard/logs/health',     label: 'System Health',  code: '07' },
] as const;

const PAGE_TITLES: Record<string, string> = {
  '/dashboard/logs/activity':   'ACTIVITY STREAM',
  '/dashboard/logs/connectors': 'CONNECTORS FLEET',
  '/dashboard/logs/commands':   'COMMAND LOG HISTORY',
  '/dashboard/logs/events':     'EVENT INGEST STREAM',
  '/dashboard/logs/sync':       'SYNC CONTEXT STORE',
  '/dashboard/logs/audit':      'AUDIT LOG / VERIFICATION',
  '/dashboard/logs/health':     'SYSTEM HEALTH DASHBOARD',
};

interface LogShellProps {
  children: ReactNode;
  headerMeta?: ReactNode;
}

export function LogShell({ children, headerMeta }: LogShellProps) {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] ?? 'LOGS';

  return (
    <div className="logs-shell" style={{ height: '100%' }}>
      {/* Sidebar */}
      <aside className="logs-sidebar">
        <div className="logs-decor-line pink" />
        <div className="logs-decor-line red" />

        <div className="logs-brand">
          0CTX_LOGS
          <small>OBSERVABILITY // V1</small>
        </div>

        <nav>
          {NAV_ITEMS.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`logs-nav-btn${pathname === item.href ? ' active' : ''}`}
            >
              {item.label}
              <span className="nav-code">{item.code}</span>
            </Link>
          ))}
        </nav>

        <div className="logs-sidebar-footer">
          &gt; CLOUD MODE<br />
          &gt; AUTH: REQUIRED
        </div>
      </aside>

      {/* Main */}
      <main className="logs-main">
        <header className="logs-header">
          <div className="logs-header-title">{title}</div>
          <div className="logs-header-meta">
            {headerMeta ?? <span className="l-dim">WS: CONNECTED</span>}
          </div>
        </header>
        <div className="logs-viewport">
          {children}
        </div>
      </main>
    </div>
  );
}
