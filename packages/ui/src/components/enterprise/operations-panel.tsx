'use client';

import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  Activity,
  AlertTriangle,
  ClipboardCheck,
  History,
  Loader2,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Wrench
} from 'lucide-react';
import {
  AuditEventEntry,
  BackupManifestEntry,
  BootstrapWorkflowResult,
  CliRunResult,
  createBackupAction,
  DoctorCheck,
  DoctorWorkflowResult,
  listAuditEventsAction,
  listBackupsAction,
  restoreBackupAction,
  runBootstrapWorkflow,
  runDoctorWorkflow,
  runInstallWorkflow,
  runRepairWorkflow,
  runStatusWorkflow,
  StatusWorkflowResult,
  SupportedClient
} from '@/app/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { cn, formatTimestamp } from '@/lib/ui';

type TabId = 'runbook' | 'diagnostics' | 'audit' | 'backups';
type WorkflowId = 'install' | 'status' | 'doctor' | 'bootstrap-dry' | 'bootstrap-apply' | 'repair';

const CLIENT_OPTIONS: SupportedClient[] = ['claude', 'cursor', 'windsurf'];
const TABS: Array<{ id: TabId; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: 'runbook', label: 'Runbook', icon: PlayCircle },
  { id: 'diagnostics', label: 'Diagnostics', icon: ClipboardCheck },
  { id: 'audit', label: 'Audit', icon: History },
  { id: 'backups', label: 'Backups', icon: ShieldCheck }
];

export type EnterpriseOperationsTabId = TabId;

function getCheckColor(status: DoctorCheck['status']) {
  if (status === 'pass') return 'text-emerald-300';
  if (status === 'warn') return 'text-amber-200';
  return 'text-rose-200';
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function EnterpriseOperationsPanel({
  activeContextId,
  activeContextName,
  onDataChanged,
  visibleTabs,
  defaultTab
}: {
  activeContextId: string | null;
  activeContextName: string | null;
  onDataChanged?: () => Promise<void> | void;
  visibleTabs?: EnterpriseOperationsTabId[];
  defaultTab?: EnterpriseOperationsTabId;
}) {
  const availableTabs = useMemo(() => {
    if (!visibleTabs || visibleTabs.length === 0) return TABS;
    const allowed = new Set(visibleTabs);
    const filtered = TABS.filter(tab => allowed.has(tab.id));
    return filtered.length > 0 ? filtered : TABS;
  }, [visibleTabs]);

  const resolvedDefaultTab = useMemo<TabId>(() => {
    if (defaultTab && availableTabs.some(tab => tab.id === defaultTab)) return defaultTab;
    return availableTabs[0]?.id ?? 'runbook';
  }, [availableTabs, defaultTab]);

  const [activeTab, setActiveTab] = useState<TabId>(resolvedDefaultTab);
  const [selectedClients, setSelectedClients] = useState<SupportedClient[]>([...CLIENT_OPTIONS]);
  const [runningWorkflow, setRunningWorkflow] = useState<WorkflowId | null>(null);
  const [lastRun, setLastRun] = useState<CliRunResult | null>(null);
  const [statusRun, setStatusRun] = useState<StatusWorkflowResult | null>(null);
  const [doctorRun, setDoctorRun] = useState<DoctorWorkflowResult | null>(null);
  const [bootstrapRun, setBootstrapRun] = useState<BootstrapWorkflowResult | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);

  const [auditScope, setAuditScope] = useState<'active' | 'all'>('active');
  const [auditEvents, setAuditEvents] = useState<AuditEventEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const [backups, setBackups] = useState<BackupManifestEntry[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupName, setBackupName] = useState('');
  const [restoreName, setRestoreName] = useState('');
  const [encryptBackup, setEncryptBackup] = useState(true);
  const [backupBusyKey, setBackupBusyKey] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);

  const hasClientSelection = selectedClients.length > 0;
  const showClientTargets = useMemo(
    () => availableTabs.some(tab => tab.id === 'runbook' || tab.id === 'diagnostics'),
    [availableTabs]
  );

  const runAndStore = useCallback(
    async (
      workflow: WorkflowId,
      runner: () => Promise<CliRunResult>,
      assign?: (result: CliRunResult) => void
    ) => {
      setWorkflowError(null);
      setRunningWorkflow(workflow);
      try {
        const result = await runner();
        assign?.(result);
        setLastRun(result);
        if (!result.ok) {
          setWorkflowError(result.stderr || `${workflow} workflow exited with code ${result.exitCode ?? 'unknown'}.`);
        } else if (workflow === 'install' || workflow === 'repair' || workflow === 'bootstrap-apply') {
          await onDataChanged?.();
        }
      } catch (error) {
        setWorkflowError(error instanceof Error ? error.message : String(error));
      } finally {
        setRunningWorkflow(null);
      }
    },
    [onDataChanged]
  );

  const refreshAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const contextId = auditScope === 'active' ? activeContextId : null;
      const events = await listAuditEventsAction(contextId, 40);
      setAuditEvents(events);
    } finally {
      setAuditLoading(false);
    }
  }, [activeContextId, auditScope]);

  const refreshBackups = useCallback(async () => {
    setBackupLoading(true);
    try {
      const next = await listBackupsAction();
      setBackups(next);
    } finally {
      setBackupLoading(false);
    }
  }, []);

  const shouldLoadAudit = useMemo(
    () => availableTabs.some(tab => tab.id === 'audit' || tab.id === 'backups'),
    [availableTabs]
  );
  const shouldLoadBackups = useMemo(
    () => availableTabs.some(tab => tab.id === 'backups'),
    [availableTabs]
  );

  useEffect(() => {
    if (!shouldLoadAudit) {
      setAuditEvents([]);
      return;
    }
    void refreshAudit();
  }, [refreshAudit, shouldLoadAudit]);

  useEffect(() => {
    if (!shouldLoadBackups) {
      setBackups([]);
      return;
    }
    void refreshBackups();
  }, [refreshBackups, shouldLoadBackups]);

  const doctorStatusSummary = useMemo(() => {
    if (!doctorRun || doctorRun.checks.length === 0) return null;
    const fail = doctorRun.checks.filter(check => check.status === 'fail').length;
    const warn = doctorRun.checks.filter(check => check.status === 'warn').length;
    const pass = doctorRun.checks.filter(check => check.status === 'pass').length;
    return { pass, warn, fail };
  }, [doctorRun]);

  useEffect(() => {
    if (availableTabs.some(tab => tab.id === activeTab)) return;
    setActiveTab(resolvedDefaultTab);
  }, [activeTab, availableTabs, resolvedDefaultTab]);

  return (
    <Panel className="p-0">
      <div className="border-b border-[var(--border-muted)] px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Enterprise Operations</p>
            <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">Install, repair, diagnostics, and governance</h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Context scope: {activeContextName ?? 'No active context selected'}
            </p>
          </div>
          {showClientTargets && (
            <div className="flex flex-wrap items-center gap-1.5">
              {CLIENT_OPTIONS.map(client => {
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
          )}
        </div>
      </div>

      {availableTabs.length > 1 && (
        <div className="border-b border-[var(--border-muted)] px-2 py-2">
          <div className="flex flex-wrap gap-1">
            {availableTabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                  activeTab === tab.id
                    ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-muted)] hover:border-[var(--border-muted)] hover:bg-[var(--surface-subtle)]'
                )}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4 p-4">
        {activeTab === 'runbook' && (
          <section className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={runningWorkflow !== null || !hasClientSelection}
                onClick={() => runAndStore('install', () => runInstallWorkflow({ clients: selectedClients }))}
              >
                {runningWorkflow === 'install' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                Install
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={runningWorkflow !== null}
                onClick={() => runAndStore('status', runStatusWorkflow, result => setStatusRun(result as StatusWorkflowResult))}
              >
                {runningWorkflow === 'status' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                Status
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={runningWorkflow !== null || !hasClientSelection}
                onClick={() =>
                  runAndStore('doctor', () => runDoctorWorkflow({ clients: selectedClients }), result =>
                    setDoctorRun(result as DoctorWorkflowResult)
                  )
                }
              >
                {runningWorkflow === 'doctor' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
                Doctor
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={runningWorkflow !== null || !hasClientSelection}
                onClick={() =>
                  runAndStore(
                    'bootstrap-dry',
                    () => runBootstrapWorkflow({ clients: selectedClients, dryRun: true }),
                    result => setBootstrapRun(result as BootstrapWorkflowResult)
                  )
                }
              >
                {runningWorkflow === 'bootstrap-dry' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Bootstrap Dry Run
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={runningWorkflow !== null || !hasClientSelection}
                onClick={() =>
                  runAndStore(
                    'bootstrap-apply',
                    () => runBootstrapWorkflow({ clients: selectedClients, dryRun: false }),
                    result => setBootstrapRun(result as BootstrapWorkflowResult)
                  )
                }
              >
                {runningWorkflow === 'bootstrap-apply' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wrench className="h-4 w-4" />
                )}
                Bootstrap Apply
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={runningWorkflow !== null || !hasClientSelection}
                onClick={() => runAndStore('repair', () => runRepairWorkflow({ clients: selectedClients }))}
              >
                {runningWorkflow === 'repair' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                Repair
              </Button>
            </div>

            {!hasClientSelection && (
              <p className="text-xs text-amber-300">Select at least one client target to run install/bootstrap/doctor/repair.</p>
            )}

            {workflowError && (
              <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger-fg)]">
                {workflowError}
              </div>
            )}

            {bootstrapRun && (
              <Panel className="space-y-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] uppercase tracking-[0.13em] text-[var(--text-muted)]">
                    Bootstrap {bootstrapRun.dryRun ? 'Dry Run' : 'Apply'}
                  </p>
                  <Badge muted={!bootstrapRun.ok}>{bootstrapRun.ok ? 'OK' : 'Check output'}</Badge>
                </div>
                {bootstrapRun.results.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">No parsed bootstrap entries yet.</p>
                ) : (
                  <div className="space-y-1">
                    {bootstrapRun.results.map(result => (
                      <div
                        key={`${result.client}-${result.configPath}`}
                        className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2"
                      >
                        <p className="text-sm font-medium text-[var(--text-primary)]">
                          {result.client}: {result.status}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">{result.configPath}</p>
                        {result.message && <p className="text-xs text-[var(--text-muted)]">{result.message}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )}

            {lastRun && (
              <Panel className="space-y-3 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.13em] text-[var(--text-muted)]">Last Command</p>
                    <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{lastRun.args.slice(1).join(' ')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge muted={!lastRun.ok}>{lastRun.ok ? 'Success' : 'Failed'}</Badge>
                    <Badge muted>
                      <Activity className="mr-1.5 h-3.5 w-3.5" />
                      {formatDuration(lastRun.durationMs)}
                    </Badge>
                  </div>
                </div>

                <div className="grid gap-2 lg:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Stdout</p>
                    <pre className="max-h-56 overflow-auto rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] p-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                      {lastRun.stdout || '(no stdout)'}
                    </pre>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Stderr</p>
                    <pre className="max-h-56 overflow-auto rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] p-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                      {lastRun.stderr || '(no stderr)'}
                    </pre>
                  </div>
                </div>
              </Panel>
            )}
          </section>
        )}

        {activeTab === 'diagnostics' && (
          <section className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={runningWorkflow !== null}
                onClick={() => runAndStore('status', runStatusWorkflow, result => setStatusRun(result as StatusWorkflowResult))}
              >
                <Activity className="h-4 w-4" />
                Refresh status
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={runningWorkflow !== null || !hasClientSelection}
                onClick={() =>
                  runAndStore('doctor', () => runDoctorWorkflow({ clients: selectedClients }), result =>
                    setDoctorRun(result as DoctorWorkflowResult)
                  )
                }
              >
                <ClipboardCheck className="h-4 w-4" />
                Run doctor
              </Button>
            </div>

            {statusRun && (
              <Panel className="space-y-2 p-3">
                <p className="text-[11px] uppercase tracking-[0.13em] text-[var(--text-muted)]">Status Snapshot</p>
                {Object.keys(statusRun.summary).length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">No parsed status details available yet.</p>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    {Object.entries(statusRun.summary).map(([key, value]) => (
                      <div key={key} className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{key}</p>
                        <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{value}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )}

            {doctorRun && (
              <Panel className="space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] uppercase tracking-[0.13em] text-[var(--text-muted)]">Doctor Checks</p>
                  {doctorStatusSummary && (
                    <div className="flex gap-2 text-xs">
                      <Badge muted>
                        pass {doctorStatusSummary.pass}
                      </Badge>
                      <Badge muted>
                        warn {doctorStatusSummary.warn}
                      </Badge>
                      <Badge muted>
                        fail {doctorStatusSummary.fail}
                      </Badge>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  {doctorRun.checks.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">No doctor checks returned yet.</p>
                  ) : (
                    doctorRun.checks.map(check => (
                      <div
                        key={check.id}
                        className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-[var(--text-primary)]">{check.id}</p>
                            <p className="text-xs text-[var(--text-muted)]">{check.message}</p>
                          </div>
                          <span className={cn('text-xs font-semibold uppercase tracking-[0.1em]', getCheckColor(check.status))}>
                            {check.status}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Panel>
            )}
          </section>
        )}

        {activeTab === 'audit' && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setAuditScope('active')}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                    auditScope === 'active'
                      ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                      : 'border-[var(--border-muted)] bg-[var(--surface-subtle)] text-[var(--text-muted)]'
                  )}
                >
                  Active context
                </button>
                <button
                  type="button"
                  onClick={() => setAuditScope('all')}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                    auditScope === 'all'
                      ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                      : 'border-[var(--border-muted)] bg-[var(--surface-subtle)] text-[var(--text-muted)]'
                  )}
                >
                  All contexts
                </button>
              </div>
              <Button variant="secondary" size="sm" onClick={refreshAudit} disabled={auditLoading}>
                {auditLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
            </div>

            <div className="space-y-1.5">
              {auditEvents.length === 0 ? (
                <Panel className="flex items-center gap-2 p-3 text-xs text-[var(--text-muted)]">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  No audit events for this scope yet.
                </Panel>
              ) : (
                auditEvents.map(event => (
                  <Panel key={event.id} className="space-y-1 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-[var(--text-primary)]">{event.action}</p>
                      <span className="text-xs text-[var(--text-muted)]">{formatTimestamp(event.createdAt)}</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">
                      context: {event.contextId ?? 'n/a'} | source: {event.source ?? 'daemon'}
                    </p>
                  </Panel>
                ))
              )}
            </div>
          </section>
        )}

        {activeTab === 'backups' && (
          <section className="space-y-3">
            <Panel className="space-y-2 p-3">
              <p className="text-[11px] uppercase tracking-[0.13em] text-[var(--text-muted)]">Create Backup</p>
              <input
                value={backupName}
                onChange={event => setBackupName(event.target.value)}
                placeholder="Optional backup name"
                className="h-9 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus-ring)]"
              />
              <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={encryptBackup}
                  onChange={event => setEncryptBackup(event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-[var(--border-strong)] bg-transparent"
                />
                Encrypt backup payload
              </label>
              <Button
                variant="primary"
                size="sm"
                disabled={!activeContextId || backupBusyKey === 'create'}
                onClick={async () => {
                  if (!activeContextId) return;
                  setBackupBusyKey('create');
                  setBackupMessage(null);
                  try {
                    const backup = await createBackupAction(activeContextId, {
                      name: backupName.trim() || undefined,
                      encrypted: encryptBackup
                    });
                    if (!backup) {
                      setBackupMessage('Backup creation failed.');
                      return;
                    }
                    setBackupMessage(`Backup created: ${backup.fileName}`);
                    setBackupName('');
                    await refreshBackups();
                    await refreshAudit();
                  } finally {
                    setBackupBusyKey(null);
                  }
                }}
              >
                {backupBusyKey === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Create backup
              </Button>
            </Panel>

            {backupMessage && (
              <div className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                {backupMessage}
              </div>
            )}

            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.13em] text-[var(--text-muted)]">Backup Inventory</p>
              <Button variant="secondary" size="sm" onClick={refreshBackups} disabled={backupLoading}>
                {backupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
            </div>

            <input
              value={restoreName}
              onChange={event => setRestoreName(event.target.value)}
              placeholder="Optional restored context name"
              className="h-9 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus-ring)]"
            />

            <div className="space-y-1.5">
              {backups.length === 0 ? (
                <Panel className="px-3 py-2 text-xs text-[var(--text-muted)]">No backups found.</Panel>
              ) : (
                backups.map(backup => {
                  const restoreKey = `restore:${backup.fileName}`;
                  const restoring = backupBusyKey === restoreKey;
                  return (
                    <Panel key={backup.fileName} className="space-y-2 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--text-primary)]">{backup.fileName}</p>
                          <p className="text-xs text-[var(--text-muted)]">
                            {formatBytes(backup.sizeBytes)} | {backup.encrypted ? 'Encrypted' : 'Plaintext'} |{' '}
                            {formatTimestamp(backup.createdAt)}
                          </p>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={backupBusyKey !== null}
                          onClick={async () => {
                            const confirmRestore = window.confirm(
                              `Restore backup "${backup.fileName}" as a new context?`
                            );
                            if (!confirmRestore) return;
                            setBackupBusyKey(restoreKey);
                            setBackupMessage(null);
                            try {
                              const restored = await restoreBackupAction(backup.fileName, {
                                name: restoreName.trim() || undefined
                              });
                              if (!restored) {
                                setBackupMessage(`Failed to restore ${backup.fileName}.`);
                                return;
                              }
                              setBackupMessage(`Restored backup into context "${restored.name}".`);
                              await onDataChanged?.();
                              await refreshAudit();
                              await refreshBackups();
                            } finally {
                              setBackupBusyKey(null);
                            }
                          }}
                        >
                          {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                          Restore
                        </Button>
                      </div>
                    </Panel>
                  );
                })
              )}
            </div>
          </section>
        )}
      </div>
    </Panel>
  );
}
