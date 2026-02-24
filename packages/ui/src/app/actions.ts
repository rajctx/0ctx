'use server';

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { sendToDaemon } from '@/lib/0ctx';
import type { ContextItem, GraphNode, GraphPayload } from '@/lib/graph';

const SUPPORTED_CLIENTS = ['claude', 'cursor', 'windsurf'] as const;
const CLI_TIMEOUT_MS = 120_000;
const INTEGRATION_POLICY_CONFIG_KEYS = [
  'integration.chatgpt.enabled',
  'integration.chatgpt.requireApproval',
  'integration.autoBootstrap'
] as const;
const DEFAULT_INTEGRATION_POLICY_CONFIG: Record<IntegrationPolicyConfigKey, boolean> = {
  'integration.chatgpt.enabled': false,
  'integration.chatgpt.requireApproval': true,
  'integration.autoBootstrap': true
};

export type SupportedClient = (typeof SUPPORTED_CLIENTS)[number];
export type CheckStatus = 'pass' | 'warn' | 'fail';

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

export type SyncPolicy = 'local_only' | 'metadata_only' | 'full_sync';

export interface SyncPolicySnapshot {
  contextId: string;
  syncPolicy: SyncPolicy;
}

export type IntegrationPolicyConfigKey = (typeof INTEGRATION_POLICY_CONFIG_KEYS)[number];

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

function normalizeClients(clients?: SupportedClient[]): SupportedClient[] {
  if (!clients || clients.length === 0) return [...SUPPORTED_CLIENTS];
  const unique = Array.from(new Set(clients));
  const filtered = unique.filter((client): client is SupportedClient =>
    SUPPORTED_CLIENTS.includes(client as SupportedClient)
  );
  return filtered.length > 0 ? filtered : [...SUPPORTED_CLIENTS];
}

function clientsArg(clients?: SupportedClient[]): string {
  const normalized = normalizeClients(clients);
  if (normalized.length === SUPPORTED_CLIENTS.length) return 'all';
  return normalized.join(',');
}

function getRepoRoot(start: string = process.cwd()): string {
  let current = path.resolve(start);

  for (let i = 0; i < 8; i += 1) {
    const packagePath = path.join(current, 'package.json');
    if (fs.existsSync(packagePath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
          workspaces?: string[];
        };
        if (Array.isArray(packageJson.workspaces) && packageJson.workspaces.includes('packages/*')) {
          return current;
        }
      } catch {
        // Continue walking upward.
      }
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return path.resolve(start, '..', '..');
}

function getCliEntry(): { repoRoot: string; cliPath: string } {
  const repoRoot = getRepoRoot();
  const cliPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js');
  return { repoRoot, cliPath };
}

async function runCli(args: string[]): Promise<CliRunResult> {
  const { repoRoot, cliPath } = getCliEntry();
  const startedAt = Date.now();

  if (!fs.existsSync(cliPath)) {
    const finishedAt = Date.now();
    return {
      ok: false,
      command: process.execPath,
      args: [cliPath, ...args],
      exitCode: 1,
      stdout: '',
      stderr: `CLI entrypoint not found at '${cliPath}'. Run 'npm run build' from repo root first.`,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt
    };
  }

  return await new Promise(resolve => {
    const commandArgs = [cliPath, ...args];
    const child = spawn(process.execPath, commandArgs, {
      cwd: repoRoot,
      env: process.env,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (exitCode: number | null, timeout = false) => {
      if (settled) return;
      settled = true;
      const finishedAt = Date.now();
      resolve({
        ok: !timeout && exitCode === 0,
        command: process.execPath,
        args: commandArgs,
        exitCode,
        stdout: stdout.trim(),
        stderr: timeout
          ? `${stderr.trim()}\nWorkflow command timed out after ${CLI_TIMEOUT_MS}ms.`.trim()
          : stderr.trim(),
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt
      });
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Best effort kill.
      }
      finish(null, true);
    }, CLI_TIMEOUT_MS);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', error => {
      clearTimeout(timer);
      stderr += `${error instanceof Error ? error.message : String(error)}\n`;
      finish(1);
    });

    child.on('close', code => {
      clearTimeout(timer);
      finish(code);
    });
  });
}

function parseDoctorChecks(stdout: string): DoctorCheck[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as { checks?: DoctorCheck[] };
    return Array.isArray(parsed.checks) ? parsed.checks : [];
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return [];
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as { checks?: DoctorCheck[] };
      return Array.isArray(parsed.checks) ? parsed.checks : [];
    } catch {
      return [];
    }
  }
}

function parseStatusSummary(stdout: string): Record<string, string> {
  return stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const separator = line.indexOf(':');
      if (separator === -1) return acc;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (key) acc[key] = value;
      return acc;
    }, {});
}

function parseBootstrapResults(stdout: string): BootstrapResultEntry[] {
  const results: BootstrapResultEntry[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('- ')) continue;
    const match = line.match(/^-\s+([^:]+):\s+([a-z_]+)\s+\((.+?)\)(?:\s+-\s+(.+))?$/i);
    if (!match) continue;
    results.push({
      client: match[1],
      status: match[2],
      configPath: match[3],
      message: match[4]
    });
  }
  return results;
}

function parseJsonOutput<T>(stdout: string): T | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}

function parseBooleanConfigOutput(stdout: string): boolean | null {
  const normalized = stdout.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return null;
}

async function readBooleanConfigKey(
  key: IntegrationPolicyConfigKey
): Promise<{ ok: true; value: boolean } | { ok: false; error: string }> {
  const result = await runCli(['config', 'get', key]);
  if (!result.ok) {
    return {
      ok: false,
      error: result.stderr || result.stdout || `Failed to read config key '${key}'.`
    };
  }

  const parsed = parseBooleanConfigOutput(result.stdout);
  if (parsed === null) {
    return {
      ok: false,
      error: `Config key '${key}' returned non-boolean value: ${result.stdout || '(empty)'}`
    };
  }

  return { ok: true, value: parsed };
}

async function writeBooleanConfigKey(
  key: IntegrationPolicyConfigKey,
  value: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await runCli(['config', 'set', key, value ? 'true' : 'false']);
  if (!result.ok) {
    return {
      ok: false,
      error: result.stderr || result.stdout || `Failed to update config key '${key}'.`
    };
  }
  return { ok: true };
}

async function readIntegrationPolicyConfigSnapshot(): Promise<IntegrationPolicyConfigSnapshot> {
  const values: Record<IntegrationPolicyConfigKey, boolean> = {
    ...DEFAULT_INTEGRATION_POLICY_CONFIG
  };
  const errors: Partial<Record<IntegrationPolicyConfigKey, string>> = {};
  const reads = await Promise.all(
    INTEGRATION_POLICY_CONFIG_KEYS.map(async key => [key, await readBooleanConfigKey(key)] as const)
  );

  for (const [key, read] of reads) {
    if (read.ok) {
      values[key] = read.value;
      continue;
    }
    errors[key] = read.error;
  }

  return {
    ok: Object.keys(errors).length === 0,
    values,
    errors
  };
}

export async function getContexts(): Promise<ContextItem[]> {
  return await sendToDaemon<ContextItem[]>('listContexts');
}

export async function getGraphData(contextId: string): Promise<GraphPayload> {
  try {
    return await sendToDaemon<GraphPayload>('getGraphData', { contextId });
  } catch (e) {
    console.error('Failed to fetch graph data', e);
    return { nodes: [], edges: [] };
  }
}

export async function updateNodeData(
  id: string,
  updates: { content?: string; tags?: string[] }
): Promise<unknown> {
  try {
    return await sendToDaemon('updateNode', { id, updates });
  } catch (e) {
    console.error('Failed to update node data', e);
    return null;
  }
}

export async function createContext(name: string, paths: string[] = []): Promise<unknown> {
  try {
    return await sendToDaemon('createContext', { name, paths });
  } catch (e) {
    console.error('Failed to create context', e);
    return null;
  }
}

export async function deleteContextAction(id: string): Promise<unknown> {
  try {
    return await sendToDaemon('deleteContext', { id });
  } catch (e) {
    console.error('Failed to delete context', e);
    return null;
  }
}

export async function deleteNodeAction(contextId: string, id: string): Promise<unknown> {
  try {
    return await sendToDaemon('deleteNode', { contextId, id });
  } catch (e) {
    console.error('Failed to delete node', e);
    return null;
  }
}

export async function addNodeAction(
  contextId: string,
  data: { type: string; content: string; tags?: string[]; key?: string }
): Promise<GraphNode | null> {
  try {
    return await sendToDaemon<GraphNode>('addNode', {
      contextId,
      type: data.type,
      content: data.content,
      tags: data.tags ?? [],
      key: data.key || undefined,
      source: 'dashboard'
    });
  } catch (e) {
    console.error('Failed to add node', e);
    return null;
  }
}

export async function getHealth(): Promise<HealthSnapshot | null> {
  try {
    return await sendToDaemon<HealthSnapshot>('health');
  } catch (e) {
    console.error('Failed to fetch health', e);
    return null;
  }
}

export async function getMetricsSnapshot(): Promise<MetricsSnapshot | null> {
  try {
    return await sendToDaemon<MetricsSnapshot>('metricsSnapshot');
  } catch (e) {
    console.error('Failed to fetch metrics', e);
    return null;
  }
}

export async function getCapabilities(): Promise<CapabilitiesSnapshot | null> {
  try {
    return await sendToDaemon<CapabilitiesSnapshot>('getCapabilities');
  } catch (e) {
    console.error('Failed to fetch capabilities', e);
    return null;
  }
}

export interface AuthStatusSnapshot {
  authenticated: boolean;
  email: string | null;
  tenantId: string | null;
  expiresAt: number | null;
  tokenExpired: boolean;
}

export async function getAuthStatus(): Promise<AuthStatusSnapshot | null> {
  try {
    return await sendToDaemon<AuthStatusSnapshot>('auth/status');
  } catch (e) {
    console.error('Failed to fetch auth status', e);
    return null;
  }
}

export async function runInstallWorkflow(options: WorkflowOptions = {}): Promise<CliRunResult> {
  const normalizedClients = normalizeClients(options.clients);
  return await runCli(['install', `--clients=${clientsArg(normalizedClients)}`]);
}

export async function runStatusWorkflow(): Promise<StatusWorkflowResult> {
  const result = await runCli(['status']);
  return {
    ...result,
    summary: parseStatusSummary(result.stdout)
  };
}

export async function runDoctorWorkflow(options: WorkflowOptions = {}): Promise<DoctorWorkflowResult> {
  const normalizedClients = normalizeClients(options.clients);
  const result = await runCli(['doctor', '--json', `--clients=${clientsArg(normalizedClients)}`]);
  return {
    ...result,
    checks: parseDoctorChecks(result.stdout)
  };
}

export async function runBootstrapWorkflow(
  options: BootstrapWorkflowOptions = {}
): Promise<BootstrapWorkflowResult> {
  const normalizedClients = normalizeClients(options.clients);
  const args = ['bootstrap', `--clients=${clientsArg(normalizedClients)}`];
  if (options.dryRun) args.push('--dry-run');
  const result = await runCli(args);

  return {
    ...result,
    dryRun: Boolean(options.dryRun),
    clients: normalizedClients,
    results: parseBootstrapResults(result.stdout)
  };
}

export async function runBootstrapJsonWorkflow(
  options: BootstrapWorkflowOptions = {}
): Promise<BootstrapJsonWorkflowResult> {
  const normalizedClients = normalizeClients(options.clients);
  const args = ['bootstrap', '--json', `--clients=${clientsArg(normalizedClients)}`];
  if (options.dryRun) args.push('--dry-run');
  const result = await runCli(args);
  return {
    ...result,
    payload: parseJsonOutput<BootstrapJsonPayload>(result.stdout)
  };
}

export async function getIntegrationPolicyConfigAction(): Promise<IntegrationPolicyConfigSnapshot> {
  return await readIntegrationPolicyConfigSnapshot();
}

export async function setIntegrationPolicyConfigAction(
  updates: Partial<Record<IntegrationPolicyConfigKey, boolean>> = {}
): Promise<IntegrationPolicyConfigSetResult> {
  const writeErrors: Partial<Record<IntegrationPolicyConfigKey, string>> = {};
  const updatedKeys: IntegrationPolicyConfigKey[] = [];

  for (const key of INTEGRATION_POLICY_CONFIG_KEYS) {
    const nextValue = updates[key];
    if (typeof nextValue !== 'boolean') continue;

    const writeResult = await writeBooleanConfigKey(key, nextValue);
    if (!writeResult.ok) {
      writeErrors[key] = writeResult.error;
      continue;
    }

    updatedKeys.push(key);
  }

  const snapshot = await readIntegrationPolicyConfigSnapshot();
  return {
    ok: snapshot.ok && Object.keys(writeErrors).length === 0,
    values: snapshot.values,
    errors: { ...snapshot.errors, ...writeErrors },
    updatedKeys
  };
}

export async function runRepairWorkflow(options: WorkflowOptions = {}): Promise<CliRunResult> {
  const normalizedClients = normalizeClients(options.clients);
  return await runCli(['repair', `--clients=${clientsArg(normalizedClients)}`]);
}

export async function runConnectorStatusWorkflow(options: {
  requireBridge?: boolean;
  cloud?: boolean;
} = {}): Promise<ConnectorStatusWorkflowResult> {
  const args = ['connector', 'status', '--json'];
  if (options.cloud) args.push('--cloud');
  if (options.requireBridge) args.push('--require-bridge');
  const result = await runCli(args);
  return {
    ...result,
    payload: parseJsonOutput<Record<string, unknown>>(result.stdout)
  };
}

export async function runConnectorVerifyWorkflow(options: {
  requireCloud?: boolean;
} = {}): Promise<ConnectorStatusWorkflowResult> {
  const args = ['connector', 'verify', '--json'];
  if (options.requireCloud) args.push('--require-cloud');
  const result = await runCli(args);
  return {
    ...result,
    payload: parseJsonOutput<Record<string, unknown>>(result.stdout)
  };
}

export async function runConnectorRegisterWorkflow(options: {
  requireCloud?: boolean;
  force?: boolean;
} = {}): Promise<ConnectorStatusWorkflowResult> {
  const args = ['connector', 'register', '--json'];
  if (options.requireCloud) args.push('--require-cloud');
  if (options.force) args.push('--force');
  const result = await runCli(args);
  return {
    ...result,
    payload: parseJsonOutput<Record<string, unknown>>(result.stdout)
  };
}

export async function runConnectorQueueStatusWorkflow(): Promise<ConnectorQueueStatusWorkflowResult> {
  const result = await runCli(['connector', 'queue', 'status', '--json']);
  return {
    ...result,
    payload: parseJsonOutput<Record<string, unknown>>(result.stdout)
  };
}

export async function runConnectorQueueDrainWorkflow(options: {
  timeoutMs?: number;
  strict?: boolean;
  failOnRetry?: boolean;
} = {}): Promise<ConnectorQueueDrainWorkflowResult> {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1_000, Math.floor(options.timeoutMs!)) : 120_000;
  const args = ['connector', 'queue', 'drain', '--wait', `--timeout-ms=${timeoutMs}`, '--json'];
  if (options.strict) args.push('--strict');
  if (options.failOnRetry) args.push('--fail-on-retry');
  const result = await runCli(args);
  return {
    ...result,
    payload: parseJsonOutput<Record<string, unknown>>(result.stdout)
  };
}

export async function runConnectorQueuePurgeWorkflow(options: {
  all?: boolean;
  olderThanHours?: number;
  minAttempts?: number;
  dryRun?: boolean;
} = {}): Promise<ConnectorQueuePurgeWorkflowResult> {
  const args = ['connector', 'queue', 'purge', '--json'];
  if (options.all ?? true) {
    args.push('--all');
  } else {
    if (Number.isFinite(options.olderThanHours)) {
      const hours = Math.max(1, Math.floor(options.olderThanHours!));
      args.push(`--older-than-hours=${hours}`);
    }
    if (Number.isFinite(options.minAttempts)) {
      const attempts = Math.max(1, Math.floor(options.minAttempts!));
      args.push(`--min-attempts=${attempts}`);
    }
  }
  if (options.dryRun ?? true) {
    args.push('--dry-run');
  } else {
    args.push('--confirm');
  }
  const result = await runCli(args);
  return {
    ...result,
    payload: parseJsonOutput<Record<string, unknown>>(result.stdout)
  };
}

export async function runConnectorQueueLogsWorkflow(options: {
  limit?: number;
  clear?: boolean;
  dryRun?: boolean;
} = {}): Promise<ConnectorQueueLogsWorkflowResult> {
  const args = ['connector', 'queue', 'logs', '--json'];
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit!)) : 50;
  args.push(`--limit=${limit}`);
  if (options.clear) {
    args.push('--clear');
    if (options.dryRun ?? true) {
      args.push('--dry-run');
    } else {
      args.push('--confirm');
    }
  }
  const result = await runCli(args);
  return {
    ...result,
    payload: parseJsonOutput<Record<string, unknown>>(result.stdout)
  };
}

export async function listAuditEventsAction(
  contextId?: string | null,
  limit = 50
): Promise<AuditEventEntry[]> {
  try {
    const params: Record<string, unknown> = { limit };
    if (contextId) params.contextId = contextId;
    return await sendToDaemon<AuditEventEntry[]>('listAuditEvents', params);
  } catch (e) {
    console.error('Failed to list audit events', e);
    return [];
  }
}

export async function listBackupsAction(): Promise<BackupManifestEntry[]> {
  try {
    return await sendToDaemon<BackupManifestEntry[]>('listBackups');
  } catch (e) {
    console.error('Failed to list backups', e);
    return [];
  }
}

export async function evaluateCompletionAction(
  contextId: string,
  options: { cooldownMs?: number; requiredGates?: string[] } = {}
): Promise<CompletionEvaluation | null> {
  if (!contextId) return null;
  try {
    return await sendToDaemon<CompletionEvaluation>('evaluateCompletion', {
      contextId,
      cooldownMs: options.cooldownMs,
      requiredGates: options.requiredGates
    });
  } catch (e) {
    console.error('Failed to evaluate completion', e);
    return null;
  }
}

export async function getSyncPolicyAction(contextId: string): Promise<SyncPolicySnapshot | null> {
  if (!contextId) return null;
  try {
    return await sendToDaemon<SyncPolicySnapshot>('getSyncPolicy', { contextId });
  } catch (e) {
    console.error('Failed to fetch sync policy', e);
    return null;
  }
}

export async function setSyncPolicyAction(
  contextId: string,
  syncPolicy: SyncPolicy
): Promise<SyncPolicySnapshot | null> {
  if (!contextId) return null;
  try {
    return await sendToDaemon<SyncPolicySnapshot>('setSyncPolicy', { contextId, syncPolicy });
  } catch (e) {
    console.error('Failed to set sync policy', e);
    return null;
  }
}

export async function createBackupAction(
  contextId: string,
  options: { name?: string; encrypted?: boolean } = {}
): Promise<BackupManifestEntry | null> {
  if (!contextId) return null;
  try {
    return await sendToDaemon<BackupManifestEntry>('createBackup', {
      contextId,
      name: options.name,
      encrypted: options.encrypted ?? true
    });
  } catch (e) {
    console.error('Failed to create backup', e);
    return null;
  }
}

export async function restoreBackupAction(
  fileName: string,
  options: { name?: string } = {}
): Promise<RestoreBackupResult | null> {
  if (!fileName) return null;
  try {
    return await sendToDaemon<RestoreBackupResult>('restoreBackup', {
      fileName,
      name: options.name
    });
  } catch (e) {
    console.error('Failed to restore backup', e);
    return null;
  }
}
