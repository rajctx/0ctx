'use client';

import EnterpriseOperationsPanel from '@/components/enterprise/operations-panel';
import { useDashboardState } from '@/components/dashboard/dashboard-state-provider';

export default function DashboardBackupsPage() {
  const { activeContext, activeContextId, refreshDashboardData } = useDashboardState();

  return (
    <div className="p-3 md:p-4">
      <EnterpriseOperationsPanel
        activeContextId={activeContextId}
        activeContextName={activeContext?.name ?? null}
        onDataChanged={refreshDashboardData}
        visibleTabs={['backups']}
        defaultTab="backups"
      />
    </div>
  );
}
