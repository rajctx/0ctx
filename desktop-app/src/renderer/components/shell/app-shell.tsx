import type { PropsWithChildren, ReactNode } from 'react';

interface AppShellProps extends PropsWithChildren {
  sidebar: ReactNode;
  topbar: ReactNode;
  contextPanel: ReactNode;
  contentClassName?: string;
}

export function AppShell({ sidebar, topbar, contextPanel, contentClassName = 'content', children }: AppShellProps) {
  return (
    <div className="desktop-shell">
      <aside className="panel sidebar">{sidebar}</aside>
      <main className="panel main">
        <div className="topbar">{topbar}</div>
        <div className={contentClassName}>{children}</div>
      </main>
      <aside className="panel ctx">{contextPanel}</aside>
    </div>
  );
}
