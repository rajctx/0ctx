import { CheckCircle2, KeyRound, LogIn, Terminal, XCircle } from 'lucide-react';
import { getAuthStatus, getHealth } from '@/app/actions';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';

export default async function SettingsPage() {
    const [auth, health] = await Promise.all([getAuthStatus(), getHealth()]);
    const healthAuth = health as Record<string, unknown> | null;
    const authField = healthAuth?.auth as Record<string, unknown> | undefined;

    const authenticated = auth?.authenticated ?? authField?.authenticated ?? false;
    const tokenExpired = auth?.tokenExpired ?? authField?.tokenExpired ?? false;
    const email = auth?.email ?? null;
    const tenantId = auth?.tenantId ?? null;
    const expiresAt = auth?.expiresAt ?? null;

    return (
        <div className="space-y-6 p-4 md:p-6">
            <div>
                <p className="text-[11px] uppercase tracking-[0.15em] text-[var(--text-muted)]">Settings</p>
                <h1 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">Authentication &amp; Configuration</h1>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                    Manage credentials and view connection state for the 0ctx sync backend.
                </p>
            </div>

            {/* Auth Status */}
            <Panel className="p-5">
                <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <KeyRound className="h-4 w-4 text-[var(--text-muted)]" />
                        <p className="text-sm font-semibold text-[var(--text-primary)]">Auth State</p>
                    </div>
                    {authenticated ? (
                        <Badge>
                            <CheckCircle2 className="mr-1 h-3 w-3 text-emerald-400" />
                            Authenticated
                        </Badge>
                    ) : tokenExpired ? (
                        <Badge muted>
                            <XCircle className="mr-1 h-3 w-3 text-amber-400" />
                            Token expired
                        </Badge>
                    ) : (
                        <Badge muted>
                            <XCircle className="mr-1 h-3 w-3 text-rose-400" />
                            Not authenticated
                        </Badge>
                    )}
                </div>

                <div className="space-y-2">
                    <Row label="Email" value={email ?? '—'} />
                    <Row label="Tenant" value={tenantId ?? '—'} />
                    <Row
                        label="Expires"
                        value={expiresAt ? new Date(expiresAt).toLocaleString() : '—'}
                    />
                    <Row label="Token file" value="~/.0ctx/auth.json" mono />
                </div>
            </Panel>

            {/* CLI Reference */}
            <Panel className="p-5">
                <div className="mb-4 flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-[var(--text-muted)]" />
                    <p className="text-sm font-semibold text-[var(--text-primary)]">CLI Commands</p>
                </div>
                <div className="space-y-2 rounded-xl bg-[var(--surface-subtle)] p-4 font-mono text-sm">
                    <CliLine cmd="0ctx auth login" comment="# device-code login flow" />
                    <CliLine cmd="0ctx auth status" comment="# show state + expiry" />
                    <CliLine cmd="0ctx auth status --json" comment="# machine-readable" />
                    <CliLine cmd="0ctx auth logout" comment="# clear token" />
                </div>
                <p className="mt-3 text-xs text-[var(--text-muted)]">
                    Set <code className="rounded bg-[var(--surface-subtle)] px-1 py-0.5 text-[var(--accent-text)]">CTX_AUTH_SERVER</code> to
                    override the default auth server (<code className="rounded bg-[var(--surface-subtle)] px-1 py-0.5 text-[var(--accent-text)]">https://auth.0ctx.com</code>).
                </p>
            </Panel>

            {/* Daemon auth field passthrough */}
            {authField && (
                <Panel className="p-5">
                    <div className="mb-3 flex items-center gap-2">
                        <LogIn className="h-4 w-4 text-[var(--text-muted)]" />
                        <p className="text-sm font-semibold text-[var(--text-primary)]">Daemon Health — Auth Field</p>
                    </div>
                    <pre className="overflow-x-auto rounded-xl bg-[var(--surface-subtle)] p-4 text-xs text-[var(--text-secondary)]">
                        {JSON.stringify(authField, null, 2)}
                    </pre>
                </Panel>
            )}
        </div>
    );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex items-center justify-between rounded-xl border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2">
            <span className="text-xs text-[var(--text-muted)]">{label}</span>
            <span className={`text-sm font-medium text-[var(--text-primary)] ${mono ? 'font-mono' : ''}`}>{value}</span>
        </div>
    );
}

function CliLine({ cmd, comment }: { cmd: string; comment: string }) {
    return (
        <div className="flex flex-wrap gap-2">
            <span className="text-[var(--accent-text)]">{cmd}</span>
            <span className="text-[var(--text-muted)]">{comment}</span>
        </div>
    );
}
