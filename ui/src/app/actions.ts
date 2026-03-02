'use server';

import { bffGet, bffPost, bffPut } from '@/lib/bff-client';
import type { BffResponse } from '@/lib/bff-client';
import type { ContextItem, GraphNode, GraphPayload } from '@/lib/graph';

// ---------------------------------------------------------------------------
// Shared types (kept for backward compatibility with existing UI components)
// ---------------------------------------------------------------------------

const SUPPORTED_CLIENTS = ['claude', 'cursor', 'windsurf'] as const;
const INTEGRATION_POLICY_CONFIG_KEYS = [
  'integration.chatgpt.enabled',
  'integration.chatgpt.requireApproval',
  'integration.autoBootstrap'
] as const;

export type SupportedClient = (typeof SUPPORTED_CLIENTS)[number];
export type CheckStatus = 'pass' | 'warn' | 'fail';
export type SyncPolicy = 'local_only' | 'metadata_only' | 'full_sync';
export type IntegrationPolicyConfigKey = (typeof INTEGRATION_POLICY_CONFIG_KEYS)[number];

export interface HealthSnapshot {
  ok?: boolean;
  status?: string;
  [key: string]: unknown;
}

export interface MetricsSnapshot {
  totalRequests?: number;
  requestCount?: number;
  requests?: number;
  [key: string]: unknown;
}

export interface CapabilitiesSnapshot {
  methods?: string[];
  apiVersion?: string;
  [key: string]: unknown;
}

export interface DoctorCheck {
  id: string;
  status: CheckStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface RuntimeStatusSnapshot {
  posture: string;
  bridgeHealthy: boolean;
  cloudConnected: boolean;
  capabilities: string[];
  cloud: Record<string, unknown> | null;
}

export interface CliRunResult {
  ok: boolean;
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

export interface BootstrapResultEntry {
  client: string;
  status: string;
  configPath: string;
  message?: string;
}

export interface BootstrapWorkflowResult extends CliRunResult {
  dryRun: boolean;
  clients: SupportedClient[];
  results: BootstrapResultEntry[];
}

export interface BootstrapJsonPayload {
  dryRun: boolean;
  clients: SupportedClient[];
  results: BootstrapResultEntry[];
}

export interface BootstrapJsonWorkflowResult extends CliRunResult {
  payload: BootstrapJsonPayload | null;
}

export interface StatusWorkflowResult extends CliRunResult {
  summary: Record<string, string>;
}

export interface DoctorWorkflowResult extends CliRunResult {
  checks: DoctorCheck[];
}

export interface ConnectorStatusWorkflowResult extends CliRunResult {
  payload: Record<string, unknown> | null;
}

export interface ConnectorQueueStatusWorkflowResult extends CliRunResult {
  payload: Record<string, unknown> | null;
}

export interface ConnectorQueueDrainWorkflowResult extends CliRunResult {
  payload: Record<string, unknown> | null;
}

export interface ConnectorQueuePurgeWorkflowResult extends CliRunResult {
  payload: Record<string, unknown> | null;
}

export interface ConnectorQueueLogsWorkflowResult extends CliRunResult {
  payload: Record<string, unknown> | null;
}

export interface CompletionEvaluation {
  contextId: string | null;
  complete: boolean;
  evaluatedAt: number;
  stabilizationCooldownMs: number;
  stabilizationWindowStartedAt: number;
  openGates: Array<{ gateId: string; severity: string | null; message: string | null }>;
  unresolvedRequiredGates: string[];
  activeLeases: Array<{ taskId: string; holder: string; expiresAt: number }>;
  recentBlockingEvents: Array<{ eventId: string; type: string; sequence: number; timestamp: number }>;
  reasons: string[];
}

export interface SyncPolicySnapshot {
  contextId: string;
  syncPolicy: SyncPolicy;
}

export interface IntegrationPolicyConfigSnapshot {
  ok: boolean;
  values: Record<IntegrationPolicyConfigKey, boolean>;
  errors: Partial<Record<IntegrationPolicyConfigKey, string>>;
}

export interface IntegrationPolicyConfigSetResult extends IntegrationPolicyConfigSnapshot {
  updatedKeys: IntegrationPolicyConfigKey[];
}

export interface WorkflowOptions {
  clients?: SupportedClient[];
}

export interface BootstrapWorkflowOptions extends WorkflowOptions {
  dryRun?: boolean;
}

export interface AuditEventEntry {
  id: string;
  action: string;
  contextId?: string | null;
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  actor?: string | null;
  source?: string | null;
  sessionToken?: string | null;
  connectionId?: string | null;
  requestId?: string | null;
  createdAt: number;
}

export interface BackupManifestEntry {
  fileName: string;
  filePath: string;
  createdAt: number;
  sizeBytes: number;
  encrypted: boolean;
}

export interface RestoreBackupResult {
  id: string;
  name: string;
  createdAt: number;
  paths?: string[];
}

export interface AuthStatusSnapshot {
  authenticated: boolean;
  email: string | null;
  tenantId: string | null;
  expiresAt: number | null;
  tokenExpired: boolean;
}

// ---------------------------------------------------------------------------
// Helper: wrap BFF calls into CliRunResult shape for backward compat
// ---------------------------------------------------------------------------

function bffToCliResult<T>(res: BffResponse<T>, label: string): CliRunResult & { payload: T | null } {
  const now = Date.now();
  return {
    ok: res.ok,
    command: 'bff',
    args: [label],
    exitCode: res.ok ? 0 : 1,
    stdout: res.ok ? JSON.stringify(res.data) : '',
    stderr: res.error?.message ?? '',
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    payload: res.data ?? null
  };
}

function normalizeClients(clients?: SupportedClient[]): SupportedClient[] {
  if (!clients || clients.length === 0) return [...SUPPORTED_CLIENTS];
  const unique = Array.from(new Set(clients));
  const filtered = unique.filter((client): client is SupportedClient =>
    SUPPORTED_CLIENTS.includes(client as SupportedClient)
  );
  return filtered.length > 0 ? filtered : [...SUPPORTED_CLIENTS];
}

// ---------------------------------------------------------------------------
// BFF-backed server actions
// ---------------------------------------------------------------------------

export async function getRuntimeStatus(): Promise<RuntimeStatusSnapshot | null> {
  const res = await bffGet<RuntimeStatusSnapshot>('/api/v1/runtime/status');
  return res.data;
}

/**
 * Single call that derives health, metrics, capabilities, and connector status
 * from one `/api/v1/runtime/status` request instead of 4 separate ones.
 */
export async function getOperationalSnapshot(): Promise<{
  health: HealthSnapshot | null;
  metrics: MetricsSnapshot | null;
  capabilities: CapabilitiesSnapshot | null;
  connectorStatus: ConnectorStatusWorkflowResult;
}> {
  const status = await getRuntimeStatus();
  if (!status) {
    const now = Date.now();
    return {
      health: null,
      metrics: null,
      capabilities: null,
      connectorStatus: {
        ok: false, command: 'bff', args: ['connector-status'],
        exitCode: 1, stdout: '', stderr: 'no status', startedAt: now,
        finishedAt: now, durationMs: 0, payload: null,
      },
    };
  }

  const health: HealthSnapshot = {
    ok: status.bridgeHealthy && status.cloudConnected,
    status: status.posture,
    posture: status.posture,
    bridgeHealthy: status.bridgeHealthy,
    cloudConnected: status.cloudConnected,
  };

  const metrics: MetricsSnapshot = { cloud: status.cloud } as MetricsSnapshot;

  const capabilities: CapabilitiesSnapshot = {
    methods: status.capabilities,
    apiVersion: '1',
  };

  const now = Date.now();
  const connectorStatus: ConnectorStatusWorkflowResult = {
    ok: true, command: 'bff', args: ['connector-status'],
    exitCode: 0, stdout: JSON.stringify(status), stderr: '',
    startedAt: now, finishedAt: now, durationMs: 0,
    payload: {
      posture: status.posture,
      daemon: { running: status.bridgeHealthy },
      registration: { registered: status.bridgeHealthy, machineId: 'hosted' },
      bridge: { healthy: status.bridgeHealthy },
      cloud: { connected: status.cloudConnected },
      runtime: { eventBridgeSupported: true, commandBridgeSupported: true, queue: { pending: 0, backoff: 0 } },
    },
  };

  return { health, metrics, capabilities, connectorStatus };
}

export async function getHealth(): Promise<HealthSnapshot | null> {
  const status = await getRuntimeStatus();
  if (!status) return null;
  return {
    ok: status.bridgeHealthy && status.cloudConnected,
    status: status.posture,
    posture: status.posture,
    bridgeHealthy: status.bridgeHealthy,
    cloudConnected: status.cloudConnected
  };
}

export async function getMetricsSnapshot(): Promise<MetricsSnapshot | null> {
  const status = await getRuntimeStatus();
  if (!status) return null;
  return { cloud: status.cloud } as MetricsSnapshot;
}

export async function getCapabilities(): Promise<CapabilitiesSnapshot | null> {
  const status = await getRuntimeStatus();
  if (!status) return null;
  return { methods: status.capabilities, apiVersion: '1' };
}

export async function getAuthStatus(): Promise<AuthStatusSnapshot | null> {
  const status = await getRuntimeStatus();
  if (!status) {
    return { authenticated: false, email: null, tenantId: null, expiresAt: null, tokenExpired: false };
  }
  return { authenticated: true, email: null, tenantId: null, expiresAt: null, tokenExpired: false };
}

export async function getContexts(): Promise<ContextItem[]> {
  const res = await bffPost<ContextItem[]>('/api/v1/runtime/doctor', { method: 'listContexts' });
  if (res.ok && Array.isArray(res.data)) return res.data;
  return [];
}

export async function getGraphData(contextId: string): Promise<GraphPayload> {
  try {
    const res = await bffPost<GraphPayload>('/api/v1/runtime/doctor', { method: 'getGraphData', contextId });
    if (res.ok && res.data) return res.data;
  } catch { /* fall through */ }
  return { nodes: [], edges: [] };
}

export async function updateNodeData(id: string, updates: { content?: string; tags?: string[] }): Promise<unknown> {
  const res = await bffPost('/api/v1/runtime/doctor', { method: 'updateNode', id, updates });
  return res.data;
}

export async function createContext(name: string, paths: string[] = []): Promise<unknown> {
  const res = await bffPost('/api/v1/runtime/doctor', { method: 'createContext', name, paths });
  return res.data;
}

export async function deleteContextAction(id: string): Promise<unknown> {
  const res = await bffPost('/api/v1/runtime/doctor', { method: 'deleteContext', id });
  return res.data;
}

export async function deleteNodeAction(contextId: string, id: string): Promise<unknown> {
  const res = await bffPost('/api/v1/runtime/doctor', { method: 'deleteNode', contextId, id });
  return res.data;
}

export async function addNodeAction(
  contextId: string,
  data: { type: string; content: string; tags?: string[]; key?: string }
): Promise<GraphNode | null> {
  const res = await bffPost<GraphNode>('/api/v1/runtime/doctor', {
    method: 'addNode', contextId, type: data.type, content: data.content,
    tags: data.tags ?? [], key: data.key || undefined, source: 'dashboard'
  });
  return res.data ?? null;
}

export async function runInstallWorkflow(options: WorkflowOptions = {}): Promise<CliRunResult> {
  const clients = normalizeClients(options.clients);
  const res = await bffPost<unknown>('/api/v1/integrations/bootstrap', { clients, dryRun: false });
  return bffToCliResult(res, 'install');
}

export async function runStatusWorkflow(): Promise<StatusWorkflowResult> {
  const res = await bffGet<RuntimeStatusSnapshot>('/api/v1/runtime/status');
  const base = bffToCliResult(res, 'status');
  const summary: Record<string, string> = {};
  if (res.data) {
    summary['posture'] = res.data.posture;
    summary['bridge'] = res.data.bridgeHealthy ? 'healthy' : 'degraded';
    summary['cloud'] = res.data.cloudConnected ? 'connected' : 'offline';
  }
  return { ...base, summary };
}

export async function runDoctorWorkflow(options: WorkflowOptions = {}): Promise<DoctorWorkflowResult> {
  const clients = normalizeClients(options.clients);
  const res = await bffPost<{ checks?: DoctorCheck[] }>('/api/v1/runtime/doctor', { clients });
  const base = bffToCliResult(res, 'doctor');
  return { ...base, checks: Array.isArray(res.data?.checks) ? res.data!.checks : [] };
}

export async function runBootstrapWorkflow(options: BootstrapWorkflowOptions = {}): Promise<BootstrapWorkflowResult> {
  const clients = normalizeClients(options.clients);
  const res = await bffPost<{ results?: BootstrapResultEntry[] }>('/api/v1/integrations/bootstrap', {
    clients, dryRun: options.dryRun ?? false
  });
  const base = bffToCliResult(res, 'bootstrap');
  return { ...base, dryRun: Boolean(options.dryRun), clients, results: Array.isArray(res.data?.results) ? res.data!.results : [] };
}

export async function runBootstrapJsonWorkflow(options: BootstrapWorkflowOptions = {}): Promise<BootstrapJsonWorkflowResult> {
  const clients = normalizeClients(options.clients);
  const res = await bffPost<BootstrapJsonPayload>('/api/v1/integrations/bootstrap', {
    clients, dryRun: options.dryRun ?? false
  });
  const base = bffToCliResult(res, 'bootstrap-json');
  return { ...base, payload: res.data ?? null };
}

export async function runRepairWorkflow(options: WorkflowOptions = {}): Promise<CliRunResult> {
  const clients = normalizeClients(options.clients);
  const res = await bffPost<unknown>('/api/v1/runtime/repair', { clients });
  return bffToCliResult(res, 'repair');
}

export async function runConnectorStatusWorkflow(options: {
  requireBridge?: boolean;
  cloud?: boolean;
} = {}): Promise<ConnectorStatusWorkflowResult> {
  const res = await bffGet<Record<string, unknown>>('/api/v1/runtime/status');
  const base = bffToCliResult(res, 'connector-status');
  const data = res.data;
  const payload: Record<string, unknown> | null = data ? {
    posture: data.posture,
    daemon: { running: data.bridgeHealthy },
    registration: { registered: data.bridgeHealthy, machineId: 'hosted' },
    bridge: { healthy: data.bridgeHealthy },
    cloud: { connected: data.cloudConnected },
    runtime: { eventBridgeSupported: true, commandBridgeSupported: true, queue: { pending: 0, backoff: 0 } }
  } : null;
  return { ...base, payload };
}

export async function runConnectorVerifyWorkflow(options: { requireCloud?: boolean } = {}): Promise<ConnectorStatusWorkflowResult> {
  return runConnectorStatusWorkflow({ cloud: options.requireCloud });
}

export async function runConnectorRegisterWorkflow(options: { requireCloud?: boolean; force?: boolean } = {}): Promise<ConnectorStatusWorkflowResult> {
  const res = await bffPost<Record<string, unknown>>('/api/v1/connector/register', {});
  const base = bffToCliResult(res, 'connector-register');
  return { ...base, payload: res.data ?? null };
}

export async function runConnectorQueueStatusWorkflow(): Promise<ConnectorQueueStatusWorkflowResult> {
  const res = await bffGet<Record<string, unknown>>('/api/v1/connector/queue/status');
  const base = bffToCliResult(res, 'connector-queue-status');
  return { ...base, payload: res.data ?? null };
}

export async function runConnectorQueueDrainWorkflow(options: {
  timeoutMs?: number; strict?: boolean; failOnRetry?: boolean;
} = {}): Promise<ConnectorQueueDrainWorkflowResult> {
  const res = await bffPost<Record<string, unknown>>('/api/v1/connector/queue/drain', {
    timeoutMs: options.timeoutMs ?? 120_000, strict: options.strict ?? false
  });
  const base = bffToCliResult(res, 'connector-queue-drain');
  return { ...base, payload: res.data ?? null };
}

export async function runConnectorQueuePurgeWorkflow(options: {
  all?: boolean; olderThanHours?: number; minAttempts?: number; dryRun?: boolean;
} = {}): Promise<ConnectorQueuePurgeWorkflowResult> {
  const res = await bffPost<Record<string, unknown>>('/api/v1/connector/queue/purge', options);
  const base = bffToCliResult(res, 'connector-queue-purge');
  return { ...base, payload: res.data ?? null };
}

export async function runConnectorQueueLogsWorkflow(options: {
  limit?: number; clear?: boolean; dryRun?: boolean;
} = {}): Promise<ConnectorQueueLogsWorkflowResult> {
  const res = await bffGet<Record<string, unknown>>('/api/v1/connector/queue/logs', { params: options as Record<string, string> });
  const base = bffToCliResult(res, 'connector-queue-logs');
  return { ...base, payload: res.data ?? null };
}

export async function listAuditEventsAction(contextId?: string | null, limit = 50): Promise<AuditEventEntry[]> {
  const params: Record<string, string> = { limit: String(limit) };
  if (contextId) params.contextId = contextId;
  const res = await bffGet<AuditEventEntry[]>('/api/v1/audit', { params });
  return Array.isArray(res.data) ? res.data : [];
}

export async function listBackupsAction(): Promise<BackupManifestEntry[]> {
  const res = await bffGet<BackupManifestEntry[]>('/api/v1/backups');
  return Array.isArray(res.data) ? res.data : [];
}

export async function createBackupAction(contextId: string, options: { name?: string; encrypted?: boolean } = {}): Promise<BackupManifestEntry | null> {
  if (!contextId) return null;
  const res = await bffPost<BackupManifestEntry>('/api/v1/backups', { contextId, name: options.name, encrypted: options.encrypted ?? true });
  return res.data ?? null;
}

export async function restoreBackupAction(fileName: string, options: { name?: string } = {}): Promise<RestoreBackupResult | null> {
  if (!fileName) return null;
  const res = await bffPost<RestoreBackupResult>('/api/v1/backups', { action: 'restore', fileName, name: options.name });
  return res.data ?? null;
}

export async function evaluateCompletionAction(contextId: string, options: { cooldownMs?: number; requiredGates?: string[] } = {}): Promise<CompletionEvaluation | null> {
  if (!contextId) return null;
  const res = await bffPost<CompletionEvaluation>('/api/v1/runtime/doctor', {
    method: 'evaluateCompletion', contextId, cooldownMs: options.cooldownMs, requiredGates: options.requiredGates
  });
  return res.data ?? null;
}

export async function getSyncPolicyAction(contextId: string): Promise<SyncPolicySnapshot | null> {
  if (!contextId) return null;
  const res = await bffGet<SyncPolicySnapshot>(`/api/v1/contexts/${encodeURIComponent(contextId)}/sync-policy`);
  return res.data ?? null;
}

export async function setSyncPolicyAction(contextId: string, syncPolicy: SyncPolicy): Promise<SyncPolicySnapshot | null> {
  if (!contextId) return null;
  const res = await bffPut<SyncPolicySnapshot>(`/api/v1/contexts/${encodeURIComponent(contextId)}/sync-policy`, { syncPolicy });
  return res.data ?? null;
}

export async function getIntegrationPolicyConfigAction(): Promise<IntegrationPolicyConfigSnapshot> {
  const defaultValues: Record<IntegrationPolicyConfigKey, boolean> = {
    'integration.chatgpt.enabled': false,
    'integration.chatgpt.requireApproval': true,
    'integration.autoBootstrap': true
  };
  const res = await bffPost<Record<string, unknown>>('/api/v1/runtime/doctor', { method: 'getIntegrationPolicyConfig' });
  if (res.ok && res.data) {
    const values = res.data.values as Record<IntegrationPolicyConfigKey, boolean> | undefined;
    return { ok: true, values: values ?? defaultValues, errors: {} };
  }
  return { ok: true, values: defaultValues, errors: {} };
}

export async function setIntegrationPolicyConfigAction(
  updates: Partial<Record<IntegrationPolicyConfigKey, boolean>> = {}
): Promise<IntegrationPolicyConfigSetResult> {
  await bffPost('/api/v1/runtime/doctor', { method: 'setIntegrationPolicyConfig', updates });
  const snapshot = await getIntegrationPolicyConfigAction();
  return { ...snapshot, updatedKeys: Object.keys(updates) as IntegrationPolicyConfigKey[] };
}
