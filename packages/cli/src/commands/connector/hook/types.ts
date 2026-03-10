import type { HookInstallClient, HookSupportedAgent } from '../../../cli-core/types';
import type { NormalizedHookPayload, TranscriptCaptureData } from '../../../hooks';

export type FlagMap = Record<string, string | boolean>;

export interface HookArtifactPaths {
    dumpPath: string | null;
    hookEventLogPath: string | null;
    transcriptDumpPath: string | null;
    transcriptHistoryPath: string | null;
    transcriptSourcePath: string | null;
}

export interface HookInstallResult {
    dryRun: boolean;
    changed: boolean;
    projectRoot: string;
    contextId: string | null;
    projectConfigPath: string;
    statePath: string;
    claudeConfigPath: string;
    claudeHookConfigured: boolean;
    claudeHookReason: string | null;
    claudeGlobalConfigPath?: string | null;
    claudeGlobalHookConfigured?: boolean;
    claudeGlobalHookReason?: string | null;
    windsurfConfigPath: string;
    windsurfHookConfigured: boolean;
    windsurfHookReason: string | null;
    cursorConfigPath: string;
    cursorHookConfigured: boolean;
    cursorHookReason: string | null;
    factoryConfigPath: string;
    factoryHookConfigured: boolean;
    factoryHookReason: string | null;
    antigravityConfigPath: string;
    antigravityHookConfigured: boolean;
    antigravityHookReason: string | null;
    codexConfigPath: string;
    codexNotifyConfigured: boolean;
    codexNotifyReason: string | null;
    warnings: string[];
    state: {
        agents: Array<{ agent: string; status: string; installed: boolean }>;
    };
}

export interface HookStatusState {
    projectRoot?: string | null;
    projectConfigPath?: string | null;
    updatedAt: number;
    agents: Array<{ agent: string; status: string; installed: boolean }>;
}

export interface HookPruneResult {
    rootDir: string;
    maxAgeDays: number;
    deletedFiles: number;
    deletedDirs: number;
    reclaimedBytes: number;
}

export interface HookSessionStartResult {
    ok: boolean;
    injected: boolean;
    reason?: string;
    contextId?: string;
    workspaceName?: string;
    captureRoot?: string;
    branch?: string | null;
    context?: string;
}

export interface HookCommandDeps {
    resolveRepoRoot: (input: string | null) => string;
    parseOptionalStringFlag: (value: string | boolean | undefined) => string | null;
    resolveContextIdForHookIngest: (repoRoot: string, explicitContextId: string | null) => Promise<string | null>;
    validateExplicitPreviewSelection: (rawClients: string | boolean | undefined, explicitPreviewList: string) => string | null;
    parseHookClients: (raw: string | boolean | undefined) => HookInstallClient[];
    installHooks: (options: {
        projectRoot: string;
        contextId: string | null;
        clients: string[];
        dryRun: boolean;
        cliCommand: string;
        installClaudeGlobal: boolean;
    }) => HookInstallResult;
    readHookInstallState: () => HookStatusState;
    parsePositiveIntegerFlag: (value: string | boolean | undefined, fallback: number) => number;
    getHookDumpRetentionDays: () => number;
    pruneHookDumps: (options: { maxAgeDays: number }) => HookPruneResult;
    resolveHookCaptureRoot: (agent: HookSupportedAgent, payload: Record<string, unknown>, repoRoot: string | null) => string | null;
    validateHookIngestWorkspace: (options: {
        agent: HookSupportedAgent;
        contextId: string;
        repoRoot: string;
        payload: Record<string, unknown>;
    }) => Promise<{ ok: boolean; captureRoot: string; error: string | null }>;
    extractSupportedHookAgent: (raw: string | null) => HookSupportedAgent | null;
    readStdinPayload: () => string;
    normalizeHookPayload: (agent: HookSupportedAgent, payload: unknown) => NormalizedHookPayload;
    resolveHookTranscriptPath: (payload: Record<string, unknown>) => string | null;
    resolveCodexSessionArchivePath: (payload: Record<string, unknown>, sessionId: string) => string | null;
    readCodexArchiveCapture: (
        archivePath: string,
        options: { sessionId: string; occurredAt: number; sessionTitle: string | null; cwd: string | null }
    ) => TranscriptCaptureData | null;
    readTranscriptCapture: (transcriptPath: string) => TranscriptCaptureData | null;
    readCodexCapture: (
        payload: Record<string, unknown>,
        options: { sessionId: string; turnId: string; occurredAt: number }
    ) => TranscriptCaptureData | null;
    readInlineHookCapture: (
        agent: HookSupportedAgent,
        payload: Record<string, unknown>,
        options: { sessionId: string; turnId: string; occurredAt: number }
    ) => TranscriptCaptureData | null;
    persistHookTranscriptSnapshot: (options: {
        agent: HookSupportedAgent;
        sessionId: string;
        transcriptPath: string | null;
    }) => string | null;
    persistHookTranscriptHistory: (options: {
        agent: HookSupportedAgent;
        sessionId: string;
        transcriptPath: string | null;
        now?: number;
    }) => string | null;
    appendHookEventLog: (options: {
        agent: HookSupportedAgent;
        sessionId: string;
        rawText: string;
    }) => string | null;
    persistHookDump: (options: {
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
    }) => string;
    buildHookCaptureMeta: (options: {
        agent: HookSupportedAgent;
        sessionId: string;
        turnId: string;
        role: string;
        occurredAt: number;
        branch: string | null;
        commitSha: string | null;
        worktreePath: string | null;
        repositoryRoot: string;
        artifacts: HookArtifactPaths;
        extra?: Record<string, unknown>;
    }) => Record<string, unknown>;
    ensureChatSessionNode: (options: {
        contextId: string;
        agent: HookSupportedAgent;
        sessionId: string;
        summary: string;
        startedAt: number;
        branch: string | null;
        commitSha: string | null;
        worktreePath: string | null;
        repositoryRoot: string;
        artifacts: HookArtifactPaths;
        sessionTitle?: string | null;
    }) => Promise<{ id?: string; content?: string } | null>;
    ensureChatCommitNode: (options: {
        contextId: string;
        agent: HookSupportedAgent;
        branch: string | null;
        commitSha: string | null;
        repositoryRoot: string;
    }) => Promise<{ id?: string } | null>;
    asRecord: (value: unknown) => Record<string, unknown> | null;
    safeGitValue: (repoRoot: string, args: string[]) => string | null;
    sendToDaemon: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
}
