import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    appendHookEventLog,
    getHookDebugRetentionDays,
    getHookDumpDir,
    getHookDumpRetentionDays,
    isHookDebugArtifactsEnabled,
    persistHookDump,
    pruneHookDumps,
    persistHookTranscriptHistory,
    persistHookTranscriptSnapshot
} from '../src/hook-dumps';

const tempDirs: string[] = [];
const originalHookDumpDir = process.env.CTX_HOOK_DUMP_DIR;
const originalHookDumpRetentionDays = process.env.CTX_HOOK_DUMP_RETENTION_DAYS;
const originalHookDebugRetentionDays = process.env.CTX_HOOK_DEBUG_RETENTION_DAYS;
const originalHookDebugArtifacts = process.env.CTX_HOOK_DEBUG_ARTIFACTS;

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '0ctx-hook-dumps-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    if (originalHookDumpDir === undefined) {
        delete process.env.CTX_HOOK_DUMP_DIR;
    } else {
        process.env.CTX_HOOK_DUMP_DIR = originalHookDumpDir;
    }
    if (originalHookDumpRetentionDays === undefined) {
        delete process.env.CTX_HOOK_DUMP_RETENTION_DAYS;
    } else {
        process.env.CTX_HOOK_DUMP_RETENTION_DAYS = originalHookDumpRetentionDays;
    }
    if (originalHookDebugRetentionDays === undefined) {
        delete process.env.CTX_HOOK_DEBUG_RETENTION_DAYS;
    } else {
        process.env.CTX_HOOK_DEBUG_RETENTION_DAYS = originalHookDebugRetentionDays;
    }
    if (originalHookDebugArtifacts === undefined) {
        delete process.env.CTX_HOOK_DEBUG_ARTIFACTS;
    } else {
        process.env.CTX_HOOK_DEBUG_ARTIFACTS = originalHookDebugArtifacts;
    }
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('hook dump persistence', () => {
    it('writes a raw hook dump to the configured directory', () => {
        const dumpRoot = createTempDir();
        process.env.CTX_HOOK_DUMP_DIR = dumpRoot;
        process.env.CTX_HOOK_DEBUG_ARTIFACTS = '1';
        const transcriptDir = createTempDir();
        const transcriptPath = path.join(transcriptDir, 'session.jsonl');
        fs.writeFileSync(transcriptPath, '{"type":"session_start"}\n', 'utf8');
        const transcriptSnapshotPath = persistHookTranscriptSnapshot({
            agent: 'factory',
            sessionId: 'demo-session',
            transcriptPath
        });
        const transcriptHistoryPath = persistHookTranscriptHistory({
            agent: 'factory',
            sessionId: 'demo-session',
            transcriptPath,
            now: 1700000000000
        });
        const eventLogPath = appendHookEventLog({
            agent: 'factory',
            sessionId: 'demo-session',
            rawText: '{"session_id":"demo-session"}'
        });

        const filePath = persistHookDump({
            agent: 'factory',
            contextId: 'ctx-1',
            rawText: '{"session_id":"demo-session"}',
            parsedPayload: { session_id: 'demo-session', value: 1 },
            normalized: {
                agent: 'factory',
                sessionId: 'demo-session',
                turnId: 'turn-1',
                role: 'assistant',
                summary: 'demo summary',
                occurredAt: 1700000000000,
                raw: { session_id: 'demo-session' }
            },
            repositoryRoot: 'C:\\repo',
            eventLogPath,
            transcriptSnapshotPath,
            transcriptHistoryPath,
            now: 1700000000000
        });

        expect(getHookDumpDir()).toBe(path.resolve(dumpRoot));
        expect(filePath.startsWith(path.join(path.resolve(dumpRoot), 'factory'))).toBe(true);
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, 'utf8')).toBe('{"session_id":"demo-session"}');

        const metaPath = filePath.replace(/\.json$/i, '.meta.json');
        expect(fs.existsSync(metaPath)).toBe(true);
        const saved = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<string, any>;
        expect(saved.agent).toBe('factory');
        expect(saved.contextId).toBe('ctx-1');
        expect(saved.repositoryRoot).toBe('C:\\repo');
        expect(saved.rawPath).toBe(filePath);
        expect(saved.eventLogPath).toBe(eventLogPath);
        expect(saved.transcriptSnapshotPath).toBe(transcriptSnapshotPath);
        expect(saved.transcriptHistoryPath).toBe(transcriptHistoryPath);
        expect(saved.normalized.summary).toBe('demo summary');
        expect(saved.payload.session_id).toBe('demo-session');
        expect(transcriptSnapshotPath).toBe(path.join(path.resolve(dumpRoot), 'factory', 'transcripts', 'demo-session.jsonl'));
        expect(transcriptHistoryPath).toBe(path.join(path.resolve(dumpRoot), 'factory', 'transcript-history', 'demo-session', '2023-11-14T22-13-20-000Z.jsonl'));
        expect(fs.readFileSync(String(transcriptSnapshotPath), 'utf8')).toBe('{"type":"session_start"}\n');
        expect(fs.readFileSync(String(transcriptHistoryPath), 'utf8')).toBe('{"type":"session_start"}\n');
        expect(fs.readFileSync(String(eventLogPath), 'utf8')).toBe('{"session_id":"demo-session"}\n');
    });

    it('keeps debug-heavy artifacts disabled by default', () => {
        const dumpRoot = createTempDir();
        process.env.CTX_HOOK_DUMP_DIR = dumpRoot;
        delete process.env.CTX_HOOK_DEBUG_ARTIFACTS;

        expect(isHookDebugArtifactsEnabled()).toBe(false);

        const transcriptDir = createTempDir();
        const transcriptPath = path.join(transcriptDir, 'session.jsonl');
        fs.writeFileSync(transcriptPath, '{"type":"session_start"}\n', 'utf8');

        const transcriptHistoryPath = persistHookTranscriptHistory({
            agent: 'factory',
            sessionId: 'demo-session',
            transcriptPath,
            now: 1700000000000
        });
        const eventLogPath = appendHookEventLog({
            agent: 'factory',
            sessionId: 'demo-session',
            rawText: '{"session_id":"demo-session"}'
        });

        expect(transcriptHistoryPath).toBeNull();
        expect(eventLogPath).toBeNull();
        expect(fs.existsSync(path.join(dumpRoot, 'factory', 'events'))).toBe(false);
        expect(fs.existsSync(path.join(dumpRoot, 'factory', 'transcript-history'))).toBe(false);
    });

    it('prunes old hook dump files using the configured retention window', () => {
        const dumpRoot = createTempDir();
        process.env.CTX_HOOK_DUMP_DIR = dumpRoot;
        process.env.CTX_HOOK_DUMP_RETENTION_DAYS = '5';
        process.env.CTX_HOOK_DEBUG_RETENTION_DAYS = '2';

        const oldFile = path.join(dumpRoot, 'factory', 'events', 'old.ndjson');
        const freshFile = path.join(dumpRoot, 'factory', 'events', 'fresh.ndjson');
        const oldTranscriptHistory = path.join(dumpRoot, 'factory', 'transcript-history', 'demo-session', 'old.jsonl');
        const stableDump = path.join(dumpRoot, 'factory', '2024-01-07T00-00-00-000Z-demo-turn.json');
        fs.mkdirSync(path.dirname(oldFile), { recursive: true });
        fs.mkdirSync(path.dirname(oldTranscriptHistory), { recursive: true });
        fs.mkdirSync(path.dirname(stableDump), { recursive: true });
        fs.writeFileSync(oldFile, 'old\n', 'utf8');
        fs.writeFileSync(freshFile, 'fresh\n', 'utf8');
        fs.writeFileSync(oldTranscriptHistory, '{"old":true}\n', 'utf8');
        fs.writeFileSync(stableDump, '{"session":"stable"}\n', 'utf8');
        fs.utimesSync(oldFile, new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T00:00:00Z'));
        fs.utimesSync(freshFile, new Date('2024-01-09T00:00:00Z'), new Date('2024-01-09T00:00:00Z'));
        fs.utimesSync(oldTranscriptHistory, new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T00:00:00Z'));
        fs.utimesSync(stableDump, new Date('2024-01-07T00:00:00Z'), new Date('2024-01-07T00:00:00Z'));

        const result = pruneHookDumps({
            now: Date.parse('2024-01-10T00:00:00Z')
        });

        expect(getHookDumpRetentionDays()).toBe(5);
        expect(getHookDebugRetentionDays()).toBe(2);
        expect(result.deletedFiles).toBe(2);
        expect(result.debugMaxAgeDays).toBe(2);
        expect(result.prunedPaths).toContain(oldFile);
        expect(result.prunedPaths).toContain(oldTranscriptHistory);
        expect(fs.existsSync(oldFile)).toBe(false);
        expect(fs.existsSync(oldTranscriptHistory)).toBe(false);
        expect(fs.existsSync(freshFile)).toBe(true);
        expect(fs.existsSync(stableDump)).toBe(true);
    });
});
