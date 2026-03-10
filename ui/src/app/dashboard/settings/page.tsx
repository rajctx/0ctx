'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CompletionEvaluation, HookHealthSnapshot, SyncPolicy, evaluateCompletionAction, getAuthStatus, getHealth, getHookHealthAction, getSyncPolicyAction, runConnectorVerifyWorkflow, runDoctorWorkflow, runStatusWorkflow, setSyncPolicyAction } from '@/app/actions';
import { useDashboardState } from '@/components/dashboard/dashboard-state-provider';
import { AuthPanel } from '@/components/dashboard/settings/auth-panel';
import { CliCommandsPanel } from '@/components/dashboard/settings/cli-commands-panel';
import { HookHealthPanel } from '@/components/dashboard/settings/hook-health-panel';
import { ReadinessPanel } from '@/components/dashboard/settings/readiness-panel';
import type { ReadinessStep } from '@/components/dashboard/settings/shared';
import { RuntimePolicyPanel } from '@/components/dashboard/settings/runtime-policy-panel';

type AuthStatusSnapshot = {
  authenticated: boolean;
  email: string | null;
  tenantId: string | null;
  expiresAt: number | null;
  tokenExpired: boolean;
};

const SYNC_POLICY_OPTIONS: SyncPolicy[] = ['local_only', 'metadata_only', 'full_sync'];

export default function SettingsPage() {
  const { activeContextId, activeContext, selectedMachineId } = useDashboardState();
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
  const [hooksLoading, setHooksLoading] = useState(false);
  const [hookHealth, setHookHealth] = useState<HookHealthSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadAuth() {
      setLoadingAuth(true);
      try {
        const [authStatus, health, hooks] = await Promise.all([getAuthStatus(), getHealth(), getHookHealthAction(selectedMachineId)]);
        if (cancelled) return;
        setAuth(authStatus);
        const healthRecord = health as Record<string, unknown> | null;
        const daemonAuth = healthRecord && typeof healthRecord.auth === 'object' && !Array.isArray(healthRecord.auth) ? (healthRecord.auth as Record<string, unknown>) : null;
        setAuthField(daemonAuth);
        setHookHealth(hooks);
      } finally {
        if (!cancelled) setLoadingAuth(false);
      }
    }
    void loadAuth();
    return () => {
      cancelled = true;
    };
  }, [selectedMachineId]);

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
          evaluateCompletionAction(activeContextId, { cooldownMs: 30_000, machineId: selectedMachineId }),
          getSyncPolicyAction(activeContextId, selectedMachineId),
        ]);
        if (cancelled) return;
        setCompletion(completionSnapshot);
        const nextPolicy = policySnapshot?.syncPolicy ?? 'metadata_only';
        setSyncPolicy(nextPolicy);
        setSyncPolicyDraft(nextPolicy);
      } catch (error) {
        if (!cancelled) setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setCompletionLoading(false);
      }
    }

    void loadRuntime();
    return () => {
      cancelled = true;
    };
  }, [activeContextId, selectedMachineId]);

  const authenticated = auth?.authenticated ?? Boolean(authField?.authenticated);
  const tokenExpired = auth?.tokenExpired ?? Boolean(authField?.tokenExpired);
  const canSavePolicy = Boolean(activeContextId) && !syncPolicyBusy && syncPolicy !== syncPolicyDraft;
  const completionReason = useMemo(() => (completion?.reasons?.length ? completion.reasons[0] : null), [completion?.reasons]);

  const refreshRuntime = useCallback(async () => {
    if (!activeContextId) return;
    setCompletionLoading(true);
    setRuntimeError(null);
    try {
      const [completionSnapshot, policySnapshot] = await Promise.all([
        evaluateCompletionAction(activeContextId, { cooldownMs: 30_000, machineId: selectedMachineId }),
        getSyncPolicyAction(activeContextId, selectedMachineId),
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
  }, [activeContextId, selectedMachineId]);

  const savePolicy = useCallback(async () => {
    if (!activeContextId) return;
    setSyncPolicyBusy(true);
    setRuntimeError(null);
    setRuntimeInfo(null);
    try {
      const saved = await setSyncPolicyAction(activeContextId, syncPolicyDraft, selectedMachineId);
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
  }, [activeContextId, selectedMachineId, syncPolicyDraft]);

  const runReadinessCheck = useCallback(async () => {
    setReadinessBusy(true);
    setReadinessSteps([]);
    try {
      const [authSnapshot, statusResult, doctorResult, connectorResult] = await Promise.all([
        getAuthStatus(),
        runStatusWorkflow(),
        runDoctorWorkflow(),
        runConnectorVerifyWorkflow({ requireCloud: true }),
      ]);

      const connectorPayload = connectorResult.payload ?? {};
      const cloud = connectorPayload.cloud as Record<string, unknown> | undefined;
      setReadinessSteps([
        {
          id: 'auth',
          status: authSnapshot?.authenticated ? 'pass' : 'fail',
          message: authSnapshot?.authenticated ? `Authenticated as ${authSnapshot.email ?? 'user'}` : 'Not authenticated',
        },
        {
          id: 'runtime',
          status: statusResult.summary?.posture === 'connected' ? 'pass' : (statusResult.summary?.posture === 'degraded' ? 'warn' : 'fail'),
          message: `Runtime posture: ${statusResult.summary?.posture ?? 'unknown'}`,
        },
        {
          id: 'doctor',
          status: doctorResult.checks.some((check) => check.status === 'fail') ? 'fail' : (doctorResult.checks.some((check) => check.status === 'warn') ? 'warn' : 'pass'),
          message: `Doctor checks: ${doctorResult.checks.length} total, ${doctorResult.checks.filter((check) => check.status === 'fail').length} fail, ${doctorResult.checks.filter((check) => check.status === 'warn').length} warn`,
        },
        {
          id: 'cloud',
          status: Boolean(cloud?.connected) ? 'pass' : 'warn',
          message: Boolean(cloud?.connected) ? 'Connector cloud bridge connected' : 'Connector cloud bridge not connected',
        },
      ]);
    } finally {
      setReadinessBusy(false);
    }
  }, []);

  const refreshHookHealth = useCallback(async () => {
    setHooksLoading(true);
    try {
      setHookHealth(await getHookHealthAction(selectedMachineId));
    } finally {
      setHooksLoading(false);
    }
  }, [selectedMachineId]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <p className="text-[11px] uppercase tracking-[0.15em] text-[var(--text-muted)]">Settings</p>
        <h1 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">Authentication, Policy & Completion</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Manage identity and context runtime policy for {activeContext?.name ?? 'the active context'}.</p>
      </div>

      <AuthPanel
        loadingAuth={loadingAuth}
        authenticated={authenticated}
        tokenExpired={tokenExpired}
        email={auth?.email ?? null}
        tenantId={auth?.tenantId ?? null}
        selectedMachineId={selectedMachineId ?? null}
        expiresAt={auth?.expiresAt ?? null}
        authField={authField}
      />

      <RuntimePolicyPanel
        activeContextId={activeContextId}
        activeContextName={activeContext?.name ?? null}
        completion={completion}
        completionLoading={completionLoading}
        completionReason={completionReason}
        syncPolicy={syncPolicy}
        syncPolicyDraft={syncPolicyDraft}
        syncPolicyBusy={syncPolicyBusy}
        syncPolicyOptions={SYNC_POLICY_OPTIONS}
        canSavePolicy={canSavePolicy}
        runtimeError={runtimeError}
        runtimeInfo={runtimeInfo}
        onRefresh={refreshRuntime}
        onSyncPolicyChange={setSyncPolicyDraft}
        onSavePolicy={savePolicy}
      />

      <ReadinessPanel readinessBusy={readinessBusy} readinessSteps={readinessSteps} onRunCheck={() => void runReadinessCheck()} />
      <HookHealthPanel hooksLoading={hooksLoading} hookHealth={hookHealth} onRefresh={() => void refreshHookHealth()} />
      <CliCommandsPanel />
    </div>
  );
}
