import fs from 'fs';
import os from 'os';
import path from 'path';
import type { HookSupportedAgent, NormalizedHookPayload } from './hooks';

function sanitizeSegment(value: string): string {
    const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
    if (normalized.length === 0) return 'unknown';
    return normalized.slice(0, 80);
}

export function getHookDumpDir(): string {
    const override = process.env.CTX_HOOK_DUMP_DIR;
    if (typeof override === 'string' && override.trim().length > 0) {
        return path.resolve(override.trim());
    }
    return path.join(os.homedir(), '.0ctx', 'hook-dumps');
}

export function getHookDumpRetentionDays(): number {
    const raw = process.env.CTX_HOOK_DUMP_RETENTION_DAYS;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return 14;
    }
    const parsed = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 14;
}

export function getHookDebugRetentionDays(): number {
    const raw = process.env.CTX_HOOK_DEBUG_RETENTION_DAYS;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return 7;
    }
    const parsed = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
}

export interface HookDumpPruneResult {
    rootDir: string;
    maxAgeDays: number;
    debugMaxAgeDays: number;
    deletedFiles: number;
    deletedDirs: number;
    reclaimedBytes: number;
    prunedPaths: string[];
}

const AUTO_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

function getAutoPruneStampPath(rootDir: string): string {
    return path.join(rootDir, '.last-prune');
}

function collectPathsForPrune(rootDir: string): string[] {
    if (!fs.existsSync(rootDir)) return [];

    const stack = [rootDir];
    const files: string[] = [];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;
        const stat = fs.statSync(current);
        if (!stat.isDirectory()) {
            files.push(current);
            continue;
        }
        for (const entry of fs.readdirSync(current)) {
            stack.push(path.join(current, entry));
        }
    }
    return files;
}

function pruneEmptyDirectories(rootDir: string): number {
    if (!fs.existsSync(rootDir)) return 0;

    let deleted = 0;
    const walk = (current: string): void => {
        if (!fs.existsSync(current) || !fs.statSync(current).isDirectory()) {
            return;
        }
        for (const entry of fs.readdirSync(current)) {
            walk(path.join(current, entry));
        }
        if (path.resolve(current) === path.resolve(rootDir)) {
            return;
        }
        if (fs.readdirSync(current).length === 0) {
            fs.rmdirSync(current);
            deleted += 1;
        }
    };

    walk(rootDir);
    return deleted;
}

export function pruneHookDumps(options: {
    rootDir?: string;
    maxAgeDays?: number;
    debugMaxAgeDays?: number;
    now?: number;
} = {}): HookDumpPruneResult {
    const rootDir = path.resolve(options.rootDir ?? getHookDumpDir());
    const maxAgeDays = options.maxAgeDays ?? getHookDumpRetentionDays();
    const debugMaxAgeDays = options.debugMaxAgeDays ?? getHookDebugRetentionDays();
    const now = options.now ?? Date.now();
    const cutoffMs = now - (maxAgeDays * 24 * 60 * 60 * 1000);
    const debugCutoffMs = now - (debugMaxAgeDays * 24 * 60 * 60 * 1000);
    const result: HookDumpPruneResult = {
        rootDir,
        maxAgeDays,
        debugMaxAgeDays,
        deletedFiles: 0,
        deletedDirs: 0,
        reclaimedBytes: 0,
        prunedPaths: []
    };

    for (const filePath of collectPathsForPrune(rootDir)) {
        const stat = fs.statSync(filePath);
        const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
        const isDebugArtifact = relativePath.includes('/events/')
            || relativePath.includes('/transcript-history/')
            || relativePath.endsWith('.ndjson');
        const fileCutoffMs = isDebugArtifact ? debugCutoffMs : cutoffMs;
        if (stat.mtimeMs > fileCutoffMs) continue;
        fs.rmSync(filePath, { force: true });
        result.deletedFiles += 1;
        result.reclaimedBytes += stat.size;
        result.prunedPaths.push(filePath);
    }

    result.deletedDirs = pruneEmptyDirectories(rootDir);
    return result;
}

function maybePruneHookDumps(rootDir: string, now: number): void {
    const stampPath = getAutoPruneStampPath(rootDir);
    try {
        if (fs.existsSync(stampPath)) {
            const previous = Number.parseInt(fs.readFileSync(stampPath, 'utf8').trim(), 10);
            if (Number.isFinite(previous) && now - previous < AUTO_PRUNE_INTERVAL_MS) {
                return;
            }
        }
        pruneHookDumps({ rootDir, now });
        fs.mkdirSync(rootDir, { recursive: true });
        fs.writeFileSync(stampPath, String(now), 'utf8');
    } catch {
        // Best effort pruning only.
    }
}

export function persistHookTranscriptSnapshot(options: {
    agent: HookSupportedAgent;
    sessionId: string;
    transcriptPath: string | null;
}): string | null {
    if (!options.transcriptPath || options.transcriptPath.trim().length === 0) {
        return null;
    }

    const sourcePath = path.resolve(options.transcriptPath);
    if (!fs.existsSync(sourcePath)) {
        return null;
    }

    const ext = path.extname(sourcePath) || '.jsonl';
    const dir = path.join(getHookDumpDir(), options.agent, 'transcripts');
    const filePath = path.join(dir, `${sanitizeSegment(options.sessionId)}${ext}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(sourcePath, filePath);
    return filePath;
}

export function persistHookTranscriptHistory(options: {
    agent: HookSupportedAgent;
    sessionId: string;
    transcriptPath: string | null;
    now?: number;
}): string | null {
    if (!options.transcriptPath || options.transcriptPath.trim().length === 0) {
        return null;
    }

    const sourcePath = path.resolve(options.transcriptPath);
    if (!fs.existsSync(sourcePath)) {
        return null;
    }

    const now = options.now ?? Date.now();
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
    const ext = path.extname(sourcePath) || '.jsonl';
    const dir = path.join(getHookDumpDir(), options.agent, 'transcript-history', sanitizeSegment(options.sessionId));
    const filePath = path.join(dir, `${stamp}${ext}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(sourcePath, filePath);
    return filePath;
}

export function appendHookEventLog(options: {
    agent: HookSupportedAgent;
    sessionId: string;
    rawText: string;
}): string {
    const dir = path.join(getHookDumpDir(), options.agent, 'events');
    const filePath = path.join(dir, `${sanitizeSegment(options.sessionId)}.ndjson`);
    const normalizedText = `${options.rawText.replace(/\s+$/, '')}\n`;
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(filePath, normalizedText, 'utf8');
    return filePath;
}

export function persistHookDump(options: {
    agent: HookSupportedAgent;
    contextId: string | null;
    rawText: string;
    parsedPayload: unknown;
    normalized: NormalizedHookPayload;
    repositoryRoot: string | null;
    eventLogPath?: string | null;
    transcriptSnapshotPath?: string | null;
    transcriptHistoryPath?: string | null;
    now?: number;
}): string {
    const now = options.now ?? Date.now();
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
    const baseName = `${stamp}-${sanitizeSegment(options.normalized.sessionId)}-${sanitizeSegment(options.normalized.turnId)}`;
    const dir = path.join(getHookDumpDir(), options.agent);
    const rawFilePath = path.join(dir, `${baseName}.json`);
    const metaFilePath = path.join(dir, `${baseName}.meta.json`);

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(rawFilePath, options.rawText, 'utf8');
    fs.writeFileSync(metaFilePath, JSON.stringify({
        dumpedAt: new Date(now).toISOString(),
        agent: options.agent,
        contextId: options.contextId,
        repositoryRoot: options.repositoryRoot,
        rawPath: rawFilePath,
        eventLogPath: options.eventLogPath ?? null,
        transcriptSnapshotPath: options.transcriptSnapshotPath ?? null,
        transcriptHistoryPath: options.transcriptHistoryPath ?? null,
        normalized: {
            sessionId: options.normalized.sessionId,
            turnId: options.normalized.turnId,
            role: options.normalized.role,
            summary: options.normalized.summary,
            occurredAt: options.normalized.occurredAt
        },
        payload: options.parsedPayload
    }, null, 2) + '\n', 'utf8');
    maybePruneHookDumps(getHookDumpDir(), now);

    return rawFilePath;
}
