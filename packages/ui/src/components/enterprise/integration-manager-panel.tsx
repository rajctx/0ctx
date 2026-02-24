'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  DownloadCloud,
  Loader2,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  Wrench
} from 'lucide-react';
import {
  BootstrapJsonWorkflowResult,
  getIntegrationPolicyConfigAction,
  runBootstrapJsonWorkflow,
  runConnectorQueueDrainWorkflow,
  runConnectorQueueStatusWorkflow,
  runConnectorRegisterWorkflow,
  runConnectorStatusWorkflow,
  runConnectorVerifyWorkflow,
  setIntegrationPolicyConfigAction,
  SupportedClient
} from '@/app/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { cn } from '@/lib/ui';

const CLIENTS: SupportedClient[] = ['claude', 'cursor', 'windsurf'];

type JobId =
  | 'bootstrap-dry'
  | 'bootstrap-apply'
  | 'connector-status'
  | 'connector-verify'
  | 'connector-register'
  | 'queue-status'
  | 'queue-drain'
  | 'policy-save';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = '-'): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'created' || normalized === 'updated' || normalized === 'exists' || normalized === 'ok') {
    return 'text-emerald-300';
  }
  if (normalized === 'skipped' || normalized === 'warn') {
    return 'text-amber-200';
  }
  return 'text-rose-200';
}

export default function IntegrationManagerPanel() {
  const [selectedClients, setSelectedClients] = useState<SupportedClient[]>([...CLIENTS]);
  const [running, setRunning] = useState<JobId | null>(null);
  const [bootstrapResult, setBootstrapResult] = useState<BootstrapJsonWorkflowResult | null>(null);
  const [statusResult, setStatusResult] = useState<Record<string, unknown> | null>(null);
  const [verifyResult, setVerifyResult] = useState<Record<string, unknown> | null>(null);
  const [registerResult, setRegisterResult] = useState<Record<string, unknown> | null>(null);
  const [queueStatusResult, setQueueStatusResult] = useState<Record<string, unknown> | null>(null);
  const [queueDrainResult, setQueueDrainResult] = useState<Record<string, unknown> | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policyInfo, setPolicyInfo] = useState<string | null>(null);
  const [policyValues, setPolicyValues] = useState<{
    chatgptEnabled: boolean;
    chatgptRequireApproval: boolean;
    autoBootstrap: boolean;
  }>({
    chatgptEnabled: false,
    chatgptRequireApproval: true,
    autoBootstrap: true
  });
  const [error, setError] = useState<string | null>(null);

  const hasSelection = selectedClients.length > 0;

  const selectedLabel = useMemo(
    () => (selectedClients.length === CLIENTS.length ? 'all' : selectedClients.join(', ')),
    [selectedClients]
  );

  const registration = asRecord(statusResult?.registration);
  const registrationRuntime = asRecord(registration?.runtime);
  const registrationQueue = asRecord(registrationRuntime?.queue);
  const queueStats = asRecord(queueStatusResult?.stats);
  const queueDrainWait = asRecord(queueDrainResult?.wait);
  const registrationRegistered = registration?.registered === true;
  const bridgeHealthy = asRecord(statusResult?.bridge)?.healthy === true;
  const queueActionsEnabled = registrationRegistered && bridgeHealthy;

  useEffect(() => {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const requested = new URLSearchParams(search).get('client');
    if (!requested) return;
    const normalized = requested.trim().toLowerCase() as SupportedClient;
    if (!CLIENTS.includes(normalized)) return;
    setSelectedClients([normalized]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initialLoad() {
      setPolicyLoading(true);
      const [status, queue, policy] = await Promise.all([
        runConnectorStatusWorkflow({ cloud: true }),
        runConnectorQueueStatusWorkflow(),
        getIntegrationPolicyConfigAction()
      ]);
      if (cancelled) return;
      setStatusResult(status.payload);
      setQueueStatusResult(queue.payload);
      setPolicyValues({
        chatgptEnabled: policy.values['integration.chatgpt.enabled'],
        chatgptRequireApproval: policy.values['integration.chatgpt.requireApproval'],
        autoBootstrap: policy.values['integration.autoBootstrap']
      });
      setPolicyError(policy.ok ? null : 'Integration policy config has unresolved read errors.');
      if (!status.ok || !queue.ok) {
        setError(status.stderr || queue.stderr || 'Unable to fetch initial connector status.');
      }
      setPolicyLoading(false);
    }
    void initialLoad();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Panel className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Integration Manager</p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">AI client registration and verification</h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Target clients: {selectedLabel}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CLIENTS.map(client => {
            const selected = selectedClients.includes(client);
            return (
              <button
                key={client}
                type="button"
                onClick={() => {
                  setSelectedClients(current => {
                    if (current.includes(client)) return current.filter(item => item !== client);
                    return [...current, client];
                  });
                }}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  selected
                    ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
                    : 'border-[var(--border-muted)] bg-[var(--surface-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                )}
              >
                {client}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        <Button
          variant="secondary"
          size="sm"
          disabled={running !== null}
          onClick={async () => {
            setRunning('connector-status');
            setError(null);
            try {
              const result = await runConnectorStatusWorkflow({ cloud: true });
              setStatusResult(result.payload);
              if (!result.ok) setError(result.stderr || 'Connector status check failed.');
            } finally {
              setRunning(null);
            }
          }}
        >
          {running === 'connector-status' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh Connector
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={running !== null || !hasSelection || !policyValues.autoBootstrap}
          onClick={async () => {
            setRunning('bootstrap-dry');
            setError(null);
            try {
              const result = await runBootstrapJsonWorkflow({ clients: selectedClients, dryRun: true });
              setBootstrapResult(result);
              if (!result.ok) setError(result.stderr || 'Bootstrap dry run failed.');
            } finally {
              setRunning(null);
            }
          }}
        >
          {running === 'bootstrap-dry' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Detect Integrations
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={running !== null || !hasSelection || !policyValues.autoBootstrap}
          onClick={async () => {
            setRunning('bootstrap-apply');
            setError(null);
            try {
              const result = await runBootstrapJsonWorkflow({ clients: selectedClients, dryRun: false });
              setBootstrapResult(result);
              if (!result.ok) setError(result.stderr || 'Bootstrap apply failed.');
            } finally {
              setRunning(null);
            }
          }}
        >
          {running === 'bootstrap-apply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
          Apply Registrations
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={running !== null}
          onClick={async () => {
            setRunning('connector-verify');
            setError(null);
            try {
              const result = await runConnectorVerifyWorkflow({ requireCloud: true });
              setVerifyResult(result.payload);
              if (!result.ok) setError(result.stderr || 'Connector verification failed.');
            } finally {
              setRunning(null);
            }
          }}
        >
          {running === 'connector-verify' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
          Verify Connector
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={running !== null}
          onClick={async () => {
            setRunning('connector-register');
            setError(null);
            try {
              const result = await runConnectorRegisterWorkflow({ requireCloud: true });
              setRegisterResult(result.payload);
              if (!result.ok) setError(result.stderr || 'Connector registration failed.');
            } finally {
              setRunning(null);
            }
          }}
        >
          {running === 'connector-register' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
          Register Connector
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={running !== null || !queueActionsEnabled}
          onClick={async () => {
            setRunning('queue-status');
            setError(null);
            try {
              const result = await runConnectorQueueStatusWorkflow();
              setQueueStatusResult(result.payload);
              if (!result.ok) setError(result.stderr || 'Connector queue status check failed.');
            } finally {
              setRunning(null);
            }
          }}
        >
          {running === 'queue-status' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Queue Status
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={running !== null || !queueActionsEnabled}
          onClick={async () => {
            setRunning('queue-drain');
            setError(null);
            try {
              const result = await runConnectorQueueDrainWorkflow({
                timeoutMs: 90_000,
                strict: false,
                failOnRetry: false
              });
              setQueueDrainResult(result.payload);
              if (!result.ok) setError(result.stderr || 'Connector queue drain failed.');
            } finally {
              setRunning(null);
            }
          }}
        >
          {running === 'queue-drain' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <DownloadCloud className="h-4 w-4" />
          )}
          Drain Queue
        </Button>
      </div>

      {!hasSelection && <p className="text-xs text-amber-300">Select at least one AI client target.</p>}
      {!policyValues.autoBootstrap && (
        <p className="text-xs text-amber-300">
          MCP auto-bootstrap policy is disabled. Enable it below to run detect/apply workflows.
        </p>
      )}
      {error && (
        <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger-fg)]">
          {error}
        </div>
      )}
      {!queueActionsEnabled && (
        <div className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--text-muted)]">
          Queue controls are capability-gated. Register connector and ensure bridge health before queue drain operations.
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel className="space-y-2 p-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Connector Posture</p>
          <div className="grid grid-cols-2 gap-2">
            <InfoCell label="Posture" value={asString(statusResult?.posture)} />
            <InfoCell label="Daemon" value={asRecord(statusResult?.daemon)?.running ? 'running' : 'not running'} />
            <InfoCell label="Cloud" value={asRecord(statusResult?.cloud)?.connected ? 'connected' : 'degraded'} />
            <InfoCell label="Machine" value={asString(registration?.machineId, 'n/a')} />
            <InfoCell
              label="Event bridge"
              value={registrationRuntime?.eventBridgeSupported ? 'supported' : 'unsupported'}
            />
            <InfoCell
              label="Command bridge"
              value={registrationRuntime?.commandBridgeSupported ? 'supported' : 'unsupported'}
            />
          </div>
        </Panel>

        <Panel className="space-y-2 p-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Queue Snapshot</p>
          <div className="grid grid-cols-2 gap-2">
            <InfoCell label="Pending" value={String(asNumber(queueStats?.pending))} />
            <InfoCell label="Ready" value={String(asNumber(queueStats?.ready))} />
            <InfoCell label="Backoff" value={String(asNumber(queueStats?.backoff))} />
            <InfoCell label="Max attempts" value={String(asNumber(queueStats?.maxAttempts))} />
            <InfoCell label="Runtime pending" value={String(asNumber(registrationQueue?.pending))} />
            <InfoCell label="Runtime backoff" value={String(asNumber(registrationQueue?.backoff))} />
          </div>
        </Panel>

        <Panel className="space-y-2 p-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Last Drain</p>
          {!queueDrainResult ? (
            <p className="text-xs text-[var(--text-muted)]">No drain run yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <InfoCell label="Sent" value={String(asNumber(queueDrainResult.sent))} />
              <InfoCell label="Failed" value={String(asNumber(queueDrainResult.failed))} />
              <InfoCell label="Batches" value={String(asNumber(queueDrainResult.batches))} />
              <InfoCell label="Reason" value={asString(queueDrainWait?.reason)} />
              <InfoCell label="Elapsed" value={`${asNumber(queueDrainWait?.elapsedMs)}ms`} />
              <InfoCell label="Timed out" value={queueDrainWait?.timedOut ? 'yes' : 'no'} />
            </div>
          )}
        </Panel>
      </div>

      <Panel className="space-y-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-[0.13em] text-[var(--text-muted)]">Integration Policy</p>
          <Badge muted={!policyValues.chatgptEnabled}>
            ChatGPT path {policyValues.chatgptEnabled ? 'enabled' : 'blocked'}
          </Badge>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <ToggleField
            label="Enable ChatGPT Path"
            description="Allow ChatGPT onboarding and verification controls."
            checked={policyValues.chatgptEnabled}
            disabled={policyLoading || policySaving}
            onChange={checked => {
              setPolicyValues(current => ({
                ...current,
                chatgptEnabled: checked
              }));
            }}
          />
          <ToggleField
            label="Require ChatGPT Approval"
            description="Require explicit approval gate before ChatGPT integration changes."
            checked={policyValues.chatgptRequireApproval}
            disabled={policyLoading || policySaving || !policyValues.chatgptEnabled}
            onChange={checked => {
              setPolicyValues(current => ({
                ...current,
                chatgptRequireApproval: checked
              }));
            }}
          />
          <ToggleField
            label="Auto-Bootstrap MCP"
            description="Automatically register MCP clients during install/setup workflows."
            checked={policyValues.autoBootstrap}
            disabled={policyLoading || policySaving}
            onChange={checked => {
              setPolicyValues(current => ({
                ...current,
                autoBootstrap: checked
              }));
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={policyLoading || policySaving}
            onClick={async () => {
              setRunning('policy-save');
              setPolicySaving(true);
              setPolicyError(null);
              setPolicyInfo(null);
              try {
                const result = await setIntegrationPolicyConfigAction({
                  'integration.chatgpt.enabled': policyValues.chatgptEnabled,
                  'integration.chatgpt.requireApproval': policyValues.chatgptRequireApproval,
                  'integration.autoBootstrap': policyValues.autoBootstrap
                });
                if (!result.ok) {
                  setPolicyError('One or more policy values failed to save.');
                } else {
                  setPolicyInfo('Integration policy saved.');
                }
                setPolicyValues({
                  chatgptEnabled: result.values['integration.chatgpt.enabled'],
                  chatgptRequireApproval: result.values['integration.chatgpt.requireApproval'],
                  autoBootstrap: result.values['integration.autoBootstrap']
                });
              } finally {
                setPolicySaving(false);
                setRunning(null);
              }
            }}
          >
            {running === 'policy-save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
            Save Policy
          </Button>
          {policyLoading && <span className="text-xs text-[var(--text-muted)]">Loading policy...</span>}
        </div>
        {policyError && (
          <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger-fg)]">
            {policyError}
          </div>
        )}
        {policyInfo && (
          <div className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--accent-text)]">
            {policyInfo}
          </div>
        )}
      </Panel>

      {bootstrapResult?.payload && (
        <Panel className="space-y-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-[0.13em] text-[var(--text-muted)]">
              Bootstrap {bootstrapResult.payload.dryRun ? 'Detection' : 'Apply'} Result
            </p>
            <Badge muted={!bootstrapResult.ok}>
              {bootstrapResult.ok ? (
                <>
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-300" />
                  Healthy
                </>
              ) : (
                <>
                  <ShieldAlert className="mr-1.5 h-3.5 w-3.5 text-rose-300" />
                  Issues
                </>
              )}
            </Badge>
          </div>
          <div className="space-y-1.5">
            {bootstrapResult.payload.results.map(item => (
              <div
                key={`${item.client}-${item.configPath}`}
                className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{item.client}</p>
                  <span className={cn('text-xs font-semibold uppercase tracking-[0.1em]', statusTone(item.status))}>
                    {item.status}
                  </span>
                </div>
                <p className="truncate text-xs text-[var(--text-muted)]">{item.configPath}</p>
                {item.message && <p className="text-xs text-[var(--text-muted)]">{item.message}</p>}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {(statusResult || verifyResult || registerResult || queueStatusResult || queueDrainResult) && (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {statusResult && (
            <Panel className="space-y-2 p-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Connector Status</p>
              <pre className="max-h-44 overflow-auto rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] p-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                {JSON.stringify(statusResult, null, 2)}
              </pre>
            </Panel>
          )}
          {verifyResult && (
            <Panel className="space-y-2 p-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Connector Verify</p>
              <pre className="max-h-44 overflow-auto rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] p-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                {JSON.stringify(verifyResult, null, 2)}
              </pre>
            </Panel>
          )}
          {registerResult && (
            <Panel className="space-y-2 p-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Connector Register</p>
              <pre className="max-h-44 overflow-auto rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] p-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                {JSON.stringify(registerResult, null, 2)}
              </pre>
            </Panel>
          )}
          {queueStatusResult && (
            <Panel className="space-y-2 p-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Queue Status</p>
              <pre className="max-h-44 overflow-auto rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] p-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                {JSON.stringify(queueStatusResult, null, 2)}
              </pre>
            </Panel>
          )}
          {queueDrainResult && (
            <Panel className="space-y-2 p-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Queue Drain</p>
              <pre className="max-h-44 overflow-auto rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] p-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                {JSON.stringify(queueDrainResult, null, 2)}
              </pre>
            </Panel>
          )}
        </div>
      )}
    </Panel>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function ToggleField({
  label,
  description,
  checked,
  disabled,
  onChange
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[var(--text-primary)]">{label}</p>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={event => onChange(event.target.checked)}
          className="h-4 w-4 rounded border-[var(--border-strong)] bg-transparent"
        />
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{description}</p>
    </div>
  );
}
