import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { auth0 } from '@/lib/auth0';
import { decodeTokenClaims } from '@/lib/bff';
import { getStore } from '@/lib/store';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { DashboardStateProvider } from '@/components/dashboard/dashboard-state-provider';

// Server component — checks session and auto-provisions the tenant row on
// first login. createTenant is an upsert so it is safe to call on every render.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth0.getSession();
  if (!session) {
    redirect('/auth/login');
  }

  // Auto-provision the tenant in Postgres.
  // The tenantId comes from the Auth0 Action custom claim in the access token.
  // Without this, the JWT carries the tenant ID but no row exists in the DB —
  // connector FKs and store.getTenant() would silently fail.
  const token = session.tokenSet?.accessToken;
  if (token) {
    const claims = decodeTokenClaims(token);
    if (claims.tenantId) {
      try {
        const store = getStore();
        // Use the Auth0 profile for the display name; falls back to email.
        const name =
          (session.user?.name as string | undefined) ??
          (session.user?.email as string | undefined) ??
          '';
        await store.createTenant({ tenantId: claims.tenantId, name, settings: {} });
      } catch {
        // Non-fatal — dashboard still renders; next load will retry.
      }
    }
  }

  return (
    <DashboardStateProvider>
      <DashboardShell>{children}</DashboardShell>
    </DashboardStateProvider>
  );
}
