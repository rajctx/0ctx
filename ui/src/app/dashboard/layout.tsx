import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { auth0 } from '@/lib/auth0';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { DashboardStateProvider } from '@/components/dashboard/dashboard-state-provider';

// Server component — checks session before rendering children.
// The proxy.ts also redirects unauthenticated dashboard requests, but this
// acts as a defense-in-depth guard at the layout level.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth0.getSession();
  if (!session) {
    redirect('/auth/login');
  }

  return (
    <DashboardStateProvider>
      <DashboardShell>{children}</DashboardShell>
    </DashboardStateProvider>
  );
}
