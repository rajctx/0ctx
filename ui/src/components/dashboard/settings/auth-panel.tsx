import { CheckCircle2, KeyRound, Loader2, LogIn, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';
import { Row } from '@/components/dashboard/settings/shared';

export function AuthPanel({
  loadingAuth,
  authenticated,
  tokenExpired,
  email,
  tenantId,
  selectedMachineId,
  expiresAt,
  authField,
}: {
  loadingAuth: boolean;
  authenticated: boolean;
  tokenExpired: boolean;
  email: string | null;
  tenantId: string | null;
  selectedMachineId: string | null;
  expiresAt: number | null;
  authField: Record<string, unknown> | null;
}) {
  return (
    <>
      <Panel className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[var(--text-muted)]" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Auth State</p>
          </div>
          {loadingAuth ? (
            <Badge muted><Loader2 className="mr-1 h-3 w-3 animate-spin" />Loading</Badge>
          ) : authenticated ? (
            <Badge><CheckCircle2 className="mr-1 h-3 w-3 text-emerald-400" />Authenticated</Badge>
          ) : tokenExpired ? (
            <Badge muted><XCircle className="mr-1 h-3 w-3 text-amber-400" />Token expired</Badge>
          ) : (
            <Badge muted><XCircle className="mr-1 h-3 w-3 text-rose-400" />Not authenticated</Badge>
          )}
        </div>

        <div className="space-y-2">
          <Row label="Email" value={email ?? '-'} />
          <Row label="Tenant" value={tenantId ?? '-'} />
          <Row label="Machine" value={selectedMachineId ?? '-'} mono />
          <Row label="Expires" value={expiresAt ? new Date(expiresAt).toLocaleString() : '-'} />
          <Row label="Token file" value="~/.0ctx/auth.json" mono />
        </div>
      </Panel>

      {authField && (
        <Panel className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <LogIn className="h-4 w-4 text-[var(--text-muted)]" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Daemon Health - Auth Field</p>
          </div>
          <pre className="overflow-x-auto rounded-xl bg-[var(--surface-subtle)] p-4 text-xs text-[var(--text-secondary)]">{JSON.stringify(authField, null, 2)}</pre>
        </Panel>
      )}
    </>
  );
}
