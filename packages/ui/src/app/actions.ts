'use server';

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { sendToDaemon } from '@/lib/0ctx';
import type { ContextItem, GraphPayload } from '@/lib/graph';

const SUPPORTED_CLIENTS = ['claude', 'cursor', 'windsurf'] as const;
const CLI_TIMEOUT_MS = 120_000;

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

export interface StatusWorkflowResult extends CliRunResult {
  summary: Record<string, string>;
}

export interface DoctorWorkflowResult extends CliRunResult {
  checks: DoctorCheck[];
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

export async function runRepairWorkflow(options: WorkflowOptions = {}): Promise<CliRunResult> {
  const normalizedClients = normalizeClients(options.clients);
  return await runCli(['repair', `--clients=${clientsArg(normalizedClients)}`]);
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
