export const GA_SUPPORTED_CLIENTS = ['claude', 'antigravity'] as const;
export const PREVIEW_SUPPORTED_CLIENTS = ['codex', 'cursor', 'windsurf'] as const;
export const SUPPORTED_CLIENTS = [...GA_SUPPORTED_CLIENTS, ...PREVIEW_SUPPORTED_CLIENTS] as const;

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

export interface HookAgentHealth {
  agent: string;
  status: 'Supported' | 'Planned' | 'Skipped';
  installed: boolean;
  command: string | null;
  updatedAt: number | null;
  notes: string | null;
}

export interface HookHealthSnapshot {
  statePath: string;
  projectRoot: string | null;
  projectConfigPath: string | null;
  updatedAt: number | null;
  agents: HookAgentHealth[];
}

export interface SyncPolicySnapshot {
  contextId: string;
  syncPolicy: SyncPolicy;
}
