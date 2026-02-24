import fs from 'fs';
import os from 'os';
import path from 'path';

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

function ensureDir(filePath: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
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
