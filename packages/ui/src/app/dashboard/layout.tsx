import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { DashboardStateProvider } from '@/components/dashboard/dashboard-state-provider';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardStateProvider>
      <DashboardShell>{children}</DashboardShell>
    </DashboardStateProvider>
  );
}
