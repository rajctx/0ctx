'use server';

import { bffGet, bffPost, bffPut } from '@/lib/bff-client';
import type { BffResponse } from '@/lib/bff-client';
import type { ContextItem, GraphNode, GraphPayload } from '@/lib/graph';

// ---------------------------------------------------------------------------
// Shared types (kept for backward compatibility with existing UI components)
// ---------------------------------------------------------------------------

const SUPPORTED_CLIENTS = ['claude', 'cursor', 'windsurf', 'codex', 'antigravity'] as const;

export type SupportedClient = (typeof SUPPORTED_CLIENTS)[number];
export type CheckStatus = 'pass' | 'warn' | 'fail';
export type SyncPolicy = 'local_only' | 'metadata_only' | 'full_sync';

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
  connectors: RuntimeConnectorSnapshot[];
  defaultMachineId?: string | null;
  viewerMachineId?: string | null;
}

export interface RuntimeConnectorSnapshot {
  machineId: string;
  posture: string;
  lastHeartbeatAt: number | null;
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

export interface StatusWorkflowResult extends CliRunResult {
  summary: Record<string, string>;
}

export interface DoctorWorkflowResult extends CliRunResult {
  checks: DoctorCheck[];
}

export interface ConnectorStatusWorkflowResult extends CliRunResult {
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

export interface WorkflowOptions {
  clients?: SupportedClient[];
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

export interface RecallFeedbackItem {
  nodeId: string;
  helpful: boolean;
  reason?: string | null;
  createdAt?: number;
}

export interface RecallFeedbackNodeSummary {
  nodeId: string;
  helpful: number;
  notHelpful: number;
  netScore: number;
  lastFeedbackAt: number;
}

export interface RecallFeedbackSummary {
  contextId?: string | null;
  total: number;
  helpfulCount: number;
  notHelpfulCount: number;
  nodeSummary: RecallFeedbackNodeSummary[];
  items: RecallFeedbackItem[];
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
  const primaryMachineId = status.defaultMachineId
    ?? (Array.isArray(status.connectors) && status.connectors.length > 0 ? status.connectors[0].machineId : null);
  const connectorStatus: ConnectorStatusWorkflowResult = {
    ok: true, command: 'bff', args: ['connector-status'],
    exitCode: 0, stdout: JSON.stringify(status), stderr: '',
    startedAt: now, finishedAt: now, durationMs: 0,
    payload: {
      posture: status.posture,
      daemon: { running: status.bridgeHealthy },
      registration: { registered: status.bridgeHealthy, machineId: primaryMachineId },
      bridge: { healthy: status.bridgeHealthy },
      cloud: { connected: status.cloudConnected },
      connectors: status.connectors,
      defaultMachineId: status.defaultMachineId ?? null,
      viewerMachineId: status.viewerMachineId ?? null,
      runtime: { eventBridgeSupported: true, commandBridgeSupported: true, queue: { pending: 0, backoff: 0 } }
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
  try {
    const { auth0 } = await import('@/lib/auth0');
    const session = await auth0.getSession();
    if (!session?.tokenSet?.accessToken) {
      return { authenticated: false, email: null, tenantId: null, expiresAt: null, tokenExpired: false };
    }

    const token = session.tokenSet.accessToken;
    const parts = token.split('.');
    let email: string | null = null;
    let tenantId: string | null = null;
    let expiresAt: number | null = null;
    let tokenExpired = false;

    if (parts.length >= 2) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
        tenantId = typeof payload['https://0ctx.com/tenant_id'] === 'string'
          ? payload['https://0ctx.com/tenant_id'] as string : null;
        email = typeof payload['https://0ctx.com/email'] === 'string'
          ? payload['https://0ctx.com/email'] as string : null;
        if (typeof payload.exp === 'number') {
          expiresAt = payload.exp * 1000; // convert to ms
          tokenExpired = Date.now() > expiresAt;
        }
      } catch { /* opaque token — leave defaults */ }
    }

    // Fallback email from session user info
    if (!email && session.user?.email) {
      email = session.user.email as string;
    }

    return { authenticated: true, email, tenantId, expiresAt, tokenExpired };
  } catch {
    return { authenticated: false, email: null, tenantId: null, expiresAt: null, tokenExpired: false };
  }
}

export async function getContexts(machineId?: string | null): Promise<ContextItem[] | null> {
  const res = await bffPost<ContextItem[]>('/api/v1/runtime/command', { method: 'listContexts', machineId: machineId ?? undefined });
  if (res.ok && Array.isArray(res.data)) return res.data;
  return null;
}

export async function getGraphData(contextId: string, machineId?: string | null): Promise<GraphPayload> {
  try {
    const res = await bffPost<GraphPayload>('/api/v1/runtime/command', { method: 'getGraphData', contextId, machineId: machineId ?? undefined });
    if (res.ok && res.data) return res.data;
  } catch { /* fall through */ }
  return { nodes: [], edges: [] };
}

export async function updateNodeData(
  id: string,
  updates: { content?: string; tags?: string[] },
  machineId?: string | null
): Promise<unknown> {
  const res = await bffPost('/api/v1/runtime/command', { method: 'updateNode', id, updates, machineId: machineId ?? undefined });
  return res.data;
}

export async function createContext(name: string, paths: string[] = [], machineId?: string | null): Promise<unknown> {
  const res = await bffPost('/api/v1/runtime/command', { method: 'createContext', name, paths, machineId: machineId ?? undefined });
  return res.data;
}

export async function deleteContextAction(id: string, machineId?: string | null): Promise<unknown> {
  const res = await bffPost('/api/v1/runtime/command', { method: 'deleteContext', id, machineId: machineId ?? undefined });
  return res.data;
}

export async function deleteNodeAction(contextId: string, id: string, machineId?: string | null): Promise<unknown> {
  const res = await bffPost('/api/v1/runtime/command', { method: 'deleteNode', contextId, id, machineId: machineId ?? undefined });
  return res.data;
}

export async function addNodeAction(
  contextId: string,
  data: { type: string; content: string; tags?: string[]; key?: string },
  machineId?: string | null
): Promise<GraphNode | null> {
  const res = await bffPost<GraphNode>('/api/v1/runtime/command', {
    method: 'addNode', contextId, type: data.type, content: data.content,
    tags: data.tags ?? [], key: data.key || undefined, source: 'dashboard',
    machineId: machineId ?? undefined
  });
  return res.data ?? null;
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
  const res = await bffPost<{ checks?: DoctorCheck[] }>('/api/v1/runtime/command', { method: 'doctor', clients });
  const base = bffToCliResult(res, 'doctor');
  return { ...base, checks: Array.isArray(res.data?.checks) ? res.data!.checks : [] };
}

export async function runConnectorStatusWorkflow(options: {
  requireBridge?: boolean;
  cloud?: boolean;
} = {}): Promise<ConnectorStatusWorkflowResult> {
  const res = await bffGet<Record<string, unknown>>('/api/v1/runtime/status');
  const base = bffToCliResult(res, 'connector-status');
  const data = res.data;
  const connectors = Array.isArray(data?.connectors) ? data.connectors as Array<Record<string, unknown>> : [];
  const primaryMachineId = typeof data?.defaultMachineId === 'string'
    ? data.defaultMachineId as string
    : (connectors.length > 0 && typeof connectors[0].machineId === 'string' ? connectors[0].machineId : null);
  const payload: Record<string, unknown> | null = data ? {
    posture: data.posture,
    daemon: { running: data.bridgeHealthy },
    registration: { registered: data.bridgeHealthy, machineId: primaryMachineId },
    bridge: { healthy: data.bridgeHealthy },
    cloud: { connected: data.cloudConnected },
    connectors,
    defaultMachineId: primaryMachineId,
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

export async function listAuditEventsAction(contextId?: string | null, limit = 50): Promise<AuditEventEntry[]> {
  const params: Record<string, string> = { limit: String(limit) };
  if (contextId) params.contextId = contextId;
  const res = await bffGet<AuditEventEntry[]>('/api/v1/audit', { params });
  return Array.isArray(res.data) ? res.data : [];
}

export async function listRecallFeedbackAction(options: {
  contextId?: string | null;
  nodeId?: string | null;
  helpful?: boolean;
  limit?: number;
  machineId?: string | null;
} = {}): Promise<RecallFeedbackSummary | null> {
  const payload: Record<string, unknown> = {
    method: 'listRecallFeedback',
    limit: options.limit ?? 50
  };
  if (options.contextId) payload.contextId = options.contextId;
  if (options.nodeId) payload.nodeId = options.nodeId;
  if (typeof options.helpful === 'boolean') payload.helpful = options.helpful;
  if (options.machineId) payload.machineId = options.machineId;

  const res = await bffPost<RecallFeedbackSummary>('/api/v1/runtime/command', payload);
  if (!res.ok || !res.data) return null;

  return {
    contextId: res.data.contextId ?? null,
    total: Number(res.data.total ?? 0),
    helpfulCount: Number(res.data.helpfulCount ?? 0),
    notHelpfulCount: Number(res.data.notHelpfulCount ?? 0),
    nodeSummary: Array.isArray(res.data.nodeSummary) ? res.data.nodeSummary : [],
    items: Array.isArray(res.data.items) ? res.data.items : []
  };
}

export async function submitRecallFeedbackAction(input: {
  nodeId: string;
  helpful: boolean;
  reason?: string;
  contextId?: string | null;
  machineId?: string | null;
}): Promise<{ ok: boolean } | null> {
  if (!input.nodeId.trim()) return null;
  const payload: Record<string, unknown> = {
    method: 'recallFeedback',
    nodeId: input.nodeId.trim(),
    helpful: input.helpful
  };
  if (input.contextId) payload.contextId = input.contextId;
  if (input.machineId) payload.machineId = input.machineId;
  const reason = input.reason?.trim();
  if (reason) payload.reason = reason;

  const res = await bffPost<{ ok?: boolean }>('/api/v1/runtime/command', payload);
  if (!res.ok) return null;
  return { ok: Boolean(res.data?.ok) };
}

export async function listBackupsAction(machineId?: string | null): Promise<BackupManifestEntry[]> {
  const params: Record<string, string> = {};
  if (machineId) params.machineId = machineId;
  const res = await bffGet<BackupManifestEntry[]>('/api/v1/backups', { params });
  return Array.isArray(res.data) ? res.data : [];
}

export async function createBackupAction(
  contextId: string,
  options: { name?: string; encrypted?: boolean } = {},
  machineId?: string | null
): Promise<BackupManifestEntry | null> {
  if (!contextId) return null;
  const res = await bffPost<BackupManifestEntry>('/api/v1/backups', {
    action: 'create',
    contextId,
    machineId: machineId ?? undefined,
    name: options.name,
    encrypted: options.encrypted ?? true
  });
  return res.data ?? null;
}

export async function restoreBackupAction(
  fileName: string,
  options: { name?: string } = {},
  machineId?: string | null
): Promise<RestoreBackupResult | null> {
  if (!fileName) return null;
  const res = await bffPost<RestoreBackupResult>('/api/v1/backups', {
    action: 'restore',
    fileName,
    machineId: machineId ?? undefined,
    name: options.name
  });
  return res.data ?? null;
}

export async function evaluateCompletionAction(
  contextId: string,
  options: { cooldownMs?: number; requiredGates?: string[]; machineId?: string | null } = {}
): Promise<CompletionEvaluation | null> {
  if (!contextId) return null;
  const res = await bffPost<CompletionEvaluation>('/api/v1/runtime/command', {
    method: 'evaluateCompletion',
    contextId,
    cooldownMs: options.cooldownMs,
    requiredGates: options.requiredGates,
    machineId: options.machineId ?? undefined
  });
  return res.data ?? null;
}

export async function getSyncPolicyAction(contextId: string, machineId?: string | null): Promise<SyncPolicySnapshot | null> {
  if (!contextId) return null;
  const params: Record<string, string> = {};
  if (machineId) params.machineId = machineId;
  const res = await bffGet<SyncPolicySnapshot>(`/api/v1/contexts/${encodeURIComponent(contextId)}/sync-policy`, { params });
  return res.data ?? null;
}

export async function setSyncPolicyAction(
  contextId: string,
  syncPolicy: SyncPolicy,
  machineId?: string | null
): Promise<SyncPolicySnapshot | null> {
  if (!contextId) return null;
  const res = await bffPut<SyncPolicySnapshot>(`/api/v1/contexts/${encodeURIComponent(contextId)}/sync-policy`, {
    syncPolicy,
    machineId: machineId ?? undefined
  });
  return res.data ?? null;
}

