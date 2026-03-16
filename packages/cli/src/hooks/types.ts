export type HookSupportedAgent = 'claude' | 'windsurf' | 'codex' | 'cursor' | 'factory' | 'antigravity';
export type HookAgent = HookSupportedAgent;

export interface HookAgentState {
    agent: HookAgent;
    status: 'Supported' | 'Planned' | 'Skipped';
    installed: boolean;
    command: string | null;
    updatedAt: number | null;
    notes: string | null;
}

export interface HookInstallState {
    version: 1;
    updatedAt: number;
    projectRoot: string | null;
    contextId: string | null;
    projectConfigPath: string | null;
    agents: HookAgentState[];
}

export interface HookInstallResult {
    changed: boolean;
    dryRun: boolean;
    statePath: string;
    projectRoot: string;
    contextId: string | null;
    projectConfigPath: string;
    claudeConfigPath: string;
    claudeHookConfigured: boolean;
    claudeHookReason: string | null;
    claudeGlobalConfigPath: string;
    claudeGlobalHookConfigured: boolean;
    claudeGlobalHookReason: string | null;
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
    state: HookInstallState;
}

export interface HookConfigResult {
    changed: boolean;
    configPath: string;
    configured: boolean;
    reason: string | null;
}

export interface NormalizedHookPayload {
    agent: HookAgent;
    sessionId: string;
    turnId: string;
    role: string;
    summary: string;
    occurredAt: number;
    raw: Record<string, unknown>;
}

export interface TranscriptCaptureMessage {
    messageId: string;
    role: string;
    text: string;
    occurredAt: number;
    parentId: string | null;
    lineNumber: number;
    raw: Record<string, unknown>;
}

export interface TranscriptCaptureData {
    summary: string | null;
    cwd: string | null;
    sessionTitle: string | null;
    startedAt: number | null;
    messages: TranscriptCaptureMessage[];
}

export const SUPPORTED_HOOK_AGENTS: HookSupportedAgent[] = [
    'claude',
    'windsurf',
    'codex',
    'cursor',
    'factory',
    'antigravity'
];

export const PREVIEW_HOOK_AGENTS = new Set<HookSupportedAgent>(['codex', 'cursor', 'windsurf']);

export const GENERIC_CAPTURE_ROOT_KEYS = [
    'meta.repositoryRoot',
    'repositoryRoot',
    'repository_root',
    'repoRoot',
    'repo_root',
    'workspaceRoot',
    'workspace_root',
    'projectRoot',
    'project_root',
    'cwd',
    'workspace.cwd',
    'workspace.path',
    'project.path',
    'project_path'
];
