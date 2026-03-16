import fs from 'fs';
import os from 'os';
import path from 'path';
import { getConfigValue } from '@0ctx/core';

let opsLogWriteWarningEmitted = false;

export type CliOpsStatus = 'success' | 'error' | 'partial' | 'dry_run';

export interface CliOpsLogEntry {
    timestamp: number;
    operation: string;
    status: CliOpsStatus;
    details?: Record<string, unknown>;
}

export function getCliOpsLogPath(): string {
    return process.env.CTX_CLI_OPS_LOG_PATH || path.join(os.homedir(), '.0ctx', 'ops.log');
}

export function getCliOpsLogRetentionDays(): number {
    const configured = getConfigValue('capture.debugRetentionDays');
    return Number.isFinite(configured) && configured > 0 ? configured : 7;
}

function ensureDir(filePath: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function pruneCliOpsLog(options: {
    filePath?: string;
    retentionDays?: number;
    now?: number;
} = {}): { path: string; retentionDays: number; prunedEntries: number; remainingEntries: number } {
    const filePath = options.filePath ?? getCliOpsLogPath();
    const retentionDays = options.retentionDays ?? getCliOpsLogRetentionDays();
    const now = options.now ?? Date.now();
    if (!fs.existsSync(filePath)) {
        return { path: filePath, retentionDays, prunedEntries: 0, remainingEntries: 0 };
    }

    const cutoffMs = now - (retentionDays * 24 * 60 * 60 * 1000);
    try {
        const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
        const kept: string[] = [];
        let prunedEntries = 0;
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line) as Partial<CliOpsLogEntry>;
                if (typeof parsed?.timestamp === 'number' && parsed.timestamp < cutoffMs) {
                    prunedEntries += 1;
                    continue;
                }
            } catch {
                // Preserve malformed lines rather than deleting unexpected data.
            }
            kept.push(line);
        }
        if (prunedEntries > 0) {
            ensureDir(filePath);
            const next = kept.length > 0 ? `${kept.join('\n')}\n` : '';
            fs.writeFileSync(filePath, next, { encoding: 'utf8', mode: 0o600 });
        }
        return { path: filePath, retentionDays, prunedEntries, remainingEntries: kept.length };
    } catch {
        return { path: filePath, retentionDays, prunedEntries: 0, remainingEntries: 0 };
    }
}

export function appendCliOpsLogEntry(entry: Omit<CliOpsLogEntry, 'timestamp'> & { timestamp?: number }): void {
    try {
        const filePath = getCliOpsLogPath();
        ensureDir(filePath);
        const line = JSON.stringify({
            timestamp: entry.timestamp ?? Date.now(),
            operation: entry.operation,
            status: entry.status,
            details: entry.details ?? {}
        });
        fs.appendFileSync(filePath, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
        pruneCliOpsLog({ filePath });
    } catch {
        // Best-effort local audit logging only; emit one warning for operator visibility.
        if (!opsLogWriteWarningEmitted) {
            opsLogWriteWarningEmitted = true;
            process.stderr.write('0ctx_warning: failed to write CLI ops log\n');
        }
    }
}

export function readCliOpsLog(limit = 100): CliOpsLogEntry[] {
    const safeLimit = Math.max(1, Math.floor(limit));
    const filePath = getCliOpsLogPath();
    if (!fs.existsSync(filePath)) return [];

    try {
        pruneCliOpsLog({ filePath });
        const lines = fs.readFileSync(filePath, 'utf8')
            .split(/\r?\n/)
            .filter(Boolean);
        const result: CliOpsLogEntry[] = [];

        for (const line of lines.slice(-safeLimit)) {
            const parsed = JSON.parse(line) as Partial<CliOpsLogEntry>;
            if (!parsed || typeof parsed.timestamp !== 'number' || typeof parsed.operation !== 'string' || typeof parsed.status !== 'string') {
                continue;
            }

            const normalizedStatus: CliOpsStatus = parsed.status === 'success'
                || parsed.status === 'error'
                || parsed.status === 'partial'
                || parsed.status === 'dry_run'
                ? parsed.status
                : 'error';

            result.push({
                timestamp: parsed.timestamp,
                operation: parsed.operation,
                status: normalizedStatus,
                details: parsed.details && typeof parsed.details === 'object' ? parsed.details as Record<string, unknown> : {}
            });
        }

        return result;
    } catch {
        return [];
    }
}

export function clearCliOpsLog(): { cleared: boolean; path: string } {
    const filePath = getCliOpsLogPath();
    if (!fs.existsSync(filePath)) {
        return { cleared: false, path: filePath };
    }

    try {
        fs.rmSync(filePath, { force: true });
        return { cleared: true, path: filePath };
    } catch {
        return { cleared: false, path: filePath };
    }
}
