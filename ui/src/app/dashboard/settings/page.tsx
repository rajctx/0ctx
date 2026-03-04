'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Gauge,
  KeyRound,
  Loader2,
  LogIn,
  RefreshCw,
  Save,
  Terminal,
  Workflow,
  XCircle
} from 'lucide-react';
import {
  CompletionEvaluation,
  evaluateCompletionAction,
  getAuthStatus,
  getHealth,
  runConnectorVerifyWorkflow,
  runDoctorWorkflow,
  runStatusWorkflow,
  getSyncPolicyAction,
  setSyncPolicyAction,
  SyncPolicy
} from '@/app/actions';
import { useDashboardState } from '@/components/dashboard/dashboard-state-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { cn } from '@/lib/ui';

type AuthStatusSnapshot = {
  authenticated: boolean;
  email: string | null;
  tenantId: string | null;
  expiresAt: number | null;
  tokenExpired: boolean;
};

type ReadinessStep = {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
};

const SYNC_POLICY_OPTIONS: SyncPolicy[] = ['local_only', 'metadata_only', 'full_sync'];

export default function SettingsPage() {
  const { activeContextId, activeContext } = useDashboardState();
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [auth, setAuth] = useState<AuthStatusSnapshot | null>(null);
  const [authField, setAuthField] = useState<Record<string, unknown> | null>(null);

  const [completion, setCompletion] = useState<CompletionEvaluation | null>(null);
  const [completionLoading, setCompletionLoading] = useState(false);
  const [syncPolicy, setSyncPolicy] = useState<SyncPolicy | null>(null);
  const [syncPolicyDraft, setSyncPolicyDraft] = useState<SyncPolicy>('metadata_only');
  const [syncPolicyBusy, setSyncPolicyBusy] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeInfo, setRuntimeInfo] = useState<string | null>(null);
  const [readinessBusy, setReadinessBusy] = useState(false);
  const [readinessSteps, setReadinessSteps] = useState<ReadinessStep[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadAuth() {
      setLoadingAuth(true);
      try {
        const [authStatus, health] = await Promise.all([getAuthStatus(), getHealth()]);
        if (cancelled) return;
        setAuth(authStatus);
        const healthRecord = health as Record<string, unknown> | null;
        const daemonAuth =
          healthRecord && typeof healthRecord.auth === 'object' && !Array.isArray(healthRecord.auth)
            ? (healthRecord.auth as Record<string, unknown>)
            : null;
        setAuthField(daemonAuth);
      } finally {
        if (!cancelled) setLoadingAuth(false);
      }
    }
    void loadAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadRuntime() {
      if (!activeContextId) {
        setCompletion(null);
        setSyncPolicy(null);
        setRuntimeError(null);
        setRuntimeInfo(null);
        return;
      }

      setCompletionLoading(true);
      setRuntimeError(null);
      try {
        const [completionSnapshot, policySnapshot] = await Promise.all([
          evaluateCompletionAction(activeContextId, { cooldownMs: 30_000 }),
          getSyncPolicyAction(activeContextId)
        ]);
        if (cancelled) return;
        setCompletion(completionSnapshot);
        const nextPolicy = policySnapshot?.syncPolicy ?? 'metadata_only';
        setSyncPolicy(nextPolicy);
        setSyncPolicyDraft(nextPolicy);
      } catch (error) {
        if (cancelled) return;
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setCompletionLoading(false);
      }
    }

    void loadRuntime();
    return () => {
      cancelled = true;
    };
  }, [activeContextId]);

  const authenticated = auth?.authenticated ?? Boolean(authField?.authenticated);
  const tokenExpired = auth?.tokenExpired ?? Boolean(authField?.tokenExpired);
  const email = auth?.email ?? null;
  const tenantId = auth?.tenantId ?? null;
  const expiresAt = auth?.expiresAt ?? null;

  const canSavePolicy = Boolean(activeContextId) && !syncPolicyBusy && syncPolicy !== syncPolicyDraft;
  const completionReason = useMemo(
    () => (completion?.reasons && completion.reasons.length > 0 ? completion.reasons[0] : null),
    [completion?.reasons]
  );

  const runReadinessCheck = useCallback(async () => {
    setReadinessBusy(true);
    setReadinessSteps([]);
    try {
      const [authSnapshot, statusResult, doctorResult, connectorResult] = await Promise.all([
        getAuthStatus(),
        runStatusWorkflow(),
        runDoctorWorkflow(),
        runConnectorVerifyWorkflow({ requireCloud: true })
      ]);

      const steps: ReadinessStep[] = [];
      steps.push({
        id: 'auth',
        status: authSnapshot?.authenticated ? 'pass' : 'fail',
        message: authSnapshot?.authenticated
          ? `Authenticated as ${authSnapshot.email ?? 'user'}`
          : 'Not authenticated'
      });

      const posture = statusResult.summary?.posture ?? 'unknown';
      steps.push({
        id: 'runtime',
        status: posture === 'connected' ? 'pass' : (posture === 'degraded' ? 'warn' : 'fail'),
        message: `Runtime posture: ${posture}`
      });

      const failedChecks = doctorResult.checks.filter(check => check.status === 'fail').length;
      const warnedChecks = doctorResult.checks.filter(check => check.status === 'warn').length;
      steps.push({
        id: 'doctor',
        status: failedChecks > 0 ? 'fail' : (warnedChecks > 0 ? 'warn' : 'pass'),
        message: `Doctor checks: ${doctorResult.checks.length} total, ${failedChecks} fail, ${warnedChecks} warn`
      });

      const connectorPayload = connectorResult.payload ?? {};
      const cloud = connectorPayload.cloud as Record<string, unknown> | undefined;
      const cloudConnected = Boolean(cloud?.connected);
      steps.push({
        id: 'cloud',
        status: cloudConnected ? 'pass' : 'warn',
        message: cloudConnected ? 'Connector cloud bridge connected' : 'Connector cloud bridge not connected'
      });

      setReadinessSteps(steps);
    } finally {
      setReadinessBusy(false);
    }
  }, []);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <p className="text-[11px] uppercase tracking-[0.15em] text-[var(--text-muted)]">Settings</p>
        <h1 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">Authentication, Policy & Completion</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Manage identity and context runtime policy for {activeContext?.name ?? 'the active context'}.
        </p>
      </div>

      <Panel className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[var(--text-muted)]" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Auth State</p>
          </div>
          {loadingAuth ? (
            <Badge muted>
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              Loading
            </Badge>
          ) : authenticated ? (
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
          <Row label="Email" value={email ?? '-'} />
          <Row label="Tenant" value={tenantId ?? '-'} />
          <Row label="Expires" value={expiresAt ? new Date(expiresAt).toLocaleString() : '-'} />
          <Row label="Token file" value="~/.0ctx/auth.json" mono />
        </div>
      </Panel>

      <Panel className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Workflow className="h-4 w-4 text-[var(--text-muted)]" />
              <p className="text-sm font-semibold text-[var(--text-primary)]">Context Completion + Sync Policy</p>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Context: {activeContext?.name ?? 'No active context selected'}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={!activeContextId || completionLoading}
            onClick={async () => {
              if (!activeContextId) return;
              setCompletionLoading(true);
              setRuntimeError(null);
              try {
                const [completionSnapshot, policySnapshot] = await Promise.all([
                  evaluateCompletionAction(activeContextId, { cooldownMs: 30_000 }),
                  getSyncPolicyAction(activeContextId)
                ]);
                setCompletion(completionSnapshot);
                if (policySnapshot) {
                  setSyncPolicy(policySnapshot.syncPolicy);
                  setSyncPolicyDraft(policySnapshot.syncPolicy);
                }
              } catch (error) {
                setRuntimeError(error instanceof Error ? error.message : String(error));
              } finally {
                setCompletionLoading(false);
              }
            }}
          >
            {completionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh Runtime
          </Button>
        </div>

        {!activeContextId && (
          <div className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--text-muted)]">
            Select a context from the sidebar to manage completion and sync policy.
          </div>
        )}

        {activeContextId && (
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel className="space-y-3 p-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Completion Evaluator</p>
                {completion ? (
                  <Badge muted={!completion.complete}>{completion.complete ? 'Complete' : 'Incomplete'}</Badge>
                ) : (
                  <Badge muted>Unknown</Badge>
                )}
              </div>
              {completion ? (
                <div className="space-y-2 text-xs text-[var(--text-secondary)]">
                  <Row label="Open gates" value={String(completion.openGates.length)} />
                  <Row label="Active leases" value={String(completion.activeLeases.length)} />
                  <Row label="Blocking events" value={String(completion.recentBlockingEvents.length)} />
                  <Row label="Cooldown" value={`${completion.stabilizationCooldownMs}ms`} />
                  <Row label="Evaluated" value={new Date(completion.evaluatedAt).toLocaleString()} />
                  {completionReason && (
                    <div className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--text-muted)]">
                      {completionReason}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">No completion snapshot loaded yet.</p>
              )}
            </Panel>

            <Panel className="space-y-3 p-3">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-[var(--text-muted)]" />
                <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Sync Policy</p>
              </div>
              <select
                value={syncPolicyDraft}
                onChange={event => setSyncPolicyDraft(event.target.value as SyncPolicy)}
                disabled={!activeContextId || syncPolicyBusy}
                className="h-9 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus-ring)]"
              >
                {SYNC_POLICY_OPTIONS.map(policy => (
                  <option key={policy} value={policy}>
                    {policy}
                  </option>
                ))}
              </select>
              <div className="text-xs text-[var(--text-muted)]">
                Current: <span className="font-semibold text-[var(--text-primary)]">{syncPolicy ?? '-'}</span>
              </div>
              <Button
                variant="primary"
                size="sm"
                disabled={!canSavePolicy}
                onClick={async () => {
                  if (!activeContextId) return;
                  setSyncPolicyBusy(true);
                  setRuntimeError(null);
                  setRuntimeInfo(null);
                  try {
                    const saved = await setSyncPolicyAction(activeContextId, syncPolicyDraft);
                    if (!saved) {
                      setRuntimeError('Failed to save sync policy.');
                      return;
                    }
                    setSyncPolicy(saved.syncPolicy);
                    setSyncPolicyDraft(saved.syncPolicy);
                    setRuntimeInfo(`Sync policy updated to ${saved.syncPolicy}.`);
                  } catch (error) {
                    setRuntimeError(error instanceof Error ? error.message : String(error));
                  } finally {
                    setSyncPolicyBusy(false);
                  }
                }}
              >
                {syncPolicyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Policy
              </Button>
            </Panel>
          </div>
        )}

        {runtimeError && (
          <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger-fg)]">
            {runtimeError}
          </div>
        )}
        {runtimeInfo && (
          <div className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--accent-text)]">
            {runtimeInfo}
          </div>
        )}
      </Panel>

      <Panel className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-[var(--text-muted)]" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Readiness Check</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={readinessBusy}
            onClick={() => {
              void runReadinessCheck();
            }}
          >
            {readinessBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Run Check
          </Button>
        </div>

        {readinessSteps.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">
            Run a one-click check for auth, daemon posture, doctor checks, and cloud bridge health.
          </p>
        ) : (
          <div className="space-y-2">
            {readinessSteps.map(step => (
              <div
                key={step.id}
                className={cn(
                  'rounded-lg border px-3 py-2 text-xs',
                  step.status === 'pass'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                    : step.status === 'warn'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                      : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                )}
              >
                <span className="mr-2 uppercase tracking-[0.08em]">{step.id}</span>
                {step.message}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <Terminal className="h-4 w-4 text-[var(--text-muted)]" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">CLI Commands</p>
        </div>
        <div className="space-y-2 rounded-xl bg-[var(--surface-subtle)] p-4 font-mono text-sm">
          <CliLine cmd="0ctx auth login" comment="# device-code login flow" />
          <CliLine cmd="0ctx setup --validate --json" comment="# preflight runtime validation" />
          <CliLine cmd="0ctx auth status --json" comment="# machine-readable auth state" />
          <CliLine cmd="0ctx sync policy get --context-id=<id>" comment="# inspect policy" />
          <CliLine cmd="0ctx sync policy set metadata_only --context-id=<id>" comment="# update policy" />
          <CliLine cmd="0ctx connector status --cloud --json" comment="# connector posture" />
          <CliLine cmd="0ctx recall feedback list --json --limit=20" comment="# ranking feedback summary" />
        </div>
      </Panel>

      {authField && (
        <Panel className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <LogIn className="h-4 w-4 text-[var(--text-muted)]" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Daemon Health - Auth Field</p>
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
