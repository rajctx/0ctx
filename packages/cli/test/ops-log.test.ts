import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { afterEach, describe, expect, it } from 'vitest';
import { appendCliOpsLogEntry, clearCliOpsLog, getCliOpsLogPath, getCliOpsLogRetentionDays, pruneCliOpsLog, readCliOpsLog } from '../src/ops-log';

const tempDirs: string[] = [];
const originalDebugRetentionDays = process.env.CTX_HOOK_DEBUG_RETENTION_DAYS;

function createTempDir(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), '0ctx-cli-ops-log-test-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    delete process.env.CTX_CLI_OPS_LOG_PATH;
    if (originalDebugRetentionDays === undefined) {
        delete process.env.CTX_HOOK_DEBUG_RETENTION_DAYS;
    } else {
        process.env.CTX_HOOK_DEBUG_RETENTION_DAYS = originalDebugRetentionDays;
    }
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('cli ops log', () => {
    it('appends and reads structured operation entries', () => {
        const tempDir = createTempDir();
        process.env.CTX_CLI_OPS_LOG_PATH = path.join(tempDir, 'ops.log');
        const now = Date.now();

        appendCliOpsLogEntry({
            timestamp: now - 1_000,
            operation: 'connector.queue.purge',
            status: 'dry_run',
            details: { removable: 12, total: 30 }
        });

        appendCliOpsLogEntry({
            timestamp: now - 500,
            operation: 'connector.queue.drain',
            status: 'partial',
            details: { reason: 'timeout', pending: 4 }
        });

        const entries = readCliOpsLog(10);
        expect(entries.length).toBe(2);
        expect(entries[0].operation).toBe('connector.queue.purge');
        expect(entries[1].status).toBe('partial');
        expect(entries[1].details?.reason).toBe('timeout');
        expect(getCliOpsLogPath().endsWith('ops.log')).toBe(true);
    });

    it('returns only the requested recent entries', () => {
        const tempDir = createTempDir();
        process.env.CTX_CLI_OPS_LOG_PATH = path.join(tempDir, 'ops.log');

        appendCliOpsLogEntry({ operation: 'op-1', status: 'success' });
        appendCliOpsLogEntry({ operation: 'op-2', status: 'success' });
        appendCliOpsLogEntry({ operation: 'op-3', status: 'success' });

        const entries = readCliOpsLog(2);
        expect(entries.length).toBe(2);
        expect(entries[0].operation).toBe('op-2');
        expect(entries[1].operation).toBe('op-3');
    });

    it('clears ops log file when requested', () => {
        const tempDir = createTempDir();
        process.env.CTX_CLI_OPS_LOG_PATH = path.join(tempDir, 'ops.log');

        appendCliOpsLogEntry({ operation: 'op-1', status: 'success' });
        expect(readCliOpsLog(10).length).toBe(1);

        const result = clearCliOpsLog();
        expect(result.cleared).toBe(true);
        expect(readCliOpsLog(10).length).toBe(0);
    });

    it('prunes stale ops log entries using the debug retention window', () => {
        const tempDir = createTempDir();
        const filePath = path.join(tempDir, 'ops.log');
        process.env.CTX_CLI_OPS_LOG_PATH = filePath;
        process.env.CTX_HOOK_DEBUG_RETENTION_DAYS = '2';
        const now = Date.now();

        writeFileSync(filePath, [
            JSON.stringify({ timestamp: now - (5 * 24 * 60 * 60 * 1000), operation: 'old-op', status: 'success', details: {} }),
            JSON.stringify({ timestamp: now - (24 * 60 * 60 * 1000), operation: 'fresh-op', status: 'success', details: {} })
        ].join('\n') + '\n', 'utf8');

        const result = pruneCliOpsLog({ now });
        expect(getCliOpsLogRetentionDays()).toBe(2);
        expect(result.prunedEntries).toBe(1);

        const entries = readCliOpsLog(10);
        expect(entries.length).toBe(1);
        expect(entries[0].operation).toBe('fresh-op');
    });
});
