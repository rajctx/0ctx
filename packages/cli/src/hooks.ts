import fs from 'fs';
import os from 'os';
import path from 'path';

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

const SUPPORTED_HOOK_AGENTS: HookSupportedAgent[] = ['claude', 'windsurf', 'codex', 'cursor', 'factory', 'antigravity'];
const CODEX_NOTIFY_BEGIN = '# BEGIN 0ctx-codex-notify';
const CODEX_NOTIFY_END = '# END 0ctx-codex-notify';
const GENERIC_CAPTURE_ROOT_KEYS = [
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

function normalizeClient(client: string): HookAgent | null {
    const value = client.trim().toLowerCase();
    if (value === 'claude' || value === 'windsurf' || value === 'codex' || value === 'cursor' || value === 'factory' || value === 'antigravity') {
        return value;
    }
    return null;
}

function toStableJson(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function writeIfChanged(filePath: string, content: string): boolean {
    const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    if (current === content) return false;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
}

function defaultHookAgents(now: number): HookAgentState[] {
    return SUPPORTED_HOOK_AGENTS.map((agent): HookAgentState => ({
        agent,
        status: 'Skipped',
        installed: false,
        command: null,
        updatedAt: now,
        notes: 'supported'
    }));
}

interface HookConfigResult {
    changed: boolean;
    configPath: string;
    configured: boolean;
    reason: string | null;
}

function buildHookCommand(
    agent: HookSupportedAgent,
    _projectRoot: string,
    cliCommand: string,
    contextId: string | null
): string {
    if (agent === 'claude' || agent === 'factory' || agent === 'antigravity') {
        return `${cliCommand} connector hook ingest --quiet --agent=${agent}`;
    }
    if (agent === 'codex') {
        return `${cliCommand} connector hook ingest --quiet --agent=codex --payload`;
    }
    const contextFlag = contextId ? ` --context-id=${contextId}` : '';
    return `${cliCommand} connector hook ingest --quiet --agent=${agent}${contextFlag}`;
}

function toTomlString(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildCodexNotifyBlock(_projectRoot: string, cliCommand: string, _contextId: string | null): string {
    const args = [
        cliCommand,
        'connector',
        'hook',
        'ingest',
        '--agent=codex'
    ];
    args.push('--payload');
    const notifyLine = `notify = [${args.map(toTomlString).join(', ')}]`;
    return `${CODEX_NOTIFY_BEGIN}\n${notifyLine}\n${CODEX_NOTIFY_END}\n`;
}

function ensureCodexNotifyConfig(options: {
    projectRoot: string;
    contextId: string | null;
    cliCommand: string;
    dryRun: boolean;
}): HookConfigResult {
    const configPath = path.join(options.projectRoot, '.codex', 'config.toml');
    const block = buildCodexNotifyBlock(options.projectRoot, options.cliCommand, options.contextId);
    const blockPattern = /# BEGIN 0ctx-codex-notify[\s\S]*?# END 0ctx-codex-notify\s*/m;
    const hasNotifyPattern = /^\s*notify\s*=/m;

    if (!fs.existsSync(configPath)) {
        if (!options.dryRun) {
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(configPath, block, 'utf8');
        }
        return {
            changed: !options.dryRun,
            configPath,
            configured: true,
            reason: null
        };
    }

    const current = fs.readFileSync(configPath, 'utf8');
    if (blockPattern.test(current)) {
        const next = current.replace(blockPattern, block);
        const changed = next !== current;
        if (changed && !options.dryRun) {
            fs.writeFileSync(configPath, next, 'utf8');
        }
        return {
            changed: changed && !options.dryRun,
            configPath,
            configured: true,
            reason: null
        };
    }

    if (hasNotifyPattern.test(current)) {
        return {
            changed: false,
            configPath,
            configured: false,
            reason: 'existing notify key found in .codex/config.toml (manual merge required)'
        };
    }

    const separator = current.endsWith('\n') ? '' : '\n';
    const next = `${current}${separator}${block}`;
    if (!options.dryRun) {
        fs.writeFileSync(configPath, next, 'utf8');
    }
    return {
        changed: !options.dryRun,
        configPath,
        configured: true,
        reason: null
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readJsonConfig(configPath: string): {
    exists: boolean;
    value: Record<string, unknown> | null;
    reason: string | null;
} {
    if (!fs.existsSync(configPath)) {
        return { exists: false, value: null, reason: null };
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown;
        if (!isRecord(parsed)) {
            return {
                exists: true,
                value: null,
                reason: 'config file must be a JSON object'
            };
        }
        return { exists: true, value: parsed, reason: null };
    } catch (error) {
        return {
            exists: true,
            value: null,
            reason: `invalid JSON: ${error instanceof Error ? error.message : 'unknown parse error'}`
        };
    }
}

function writeJsonConfig(configPath: string, value: Record<string, unknown>, dryRun: boolean): boolean {
    const next = toStableJson(value);
    const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : null;
    if (current === next) return false;
    if (!dryRun) {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, next, 'utf8');
    }
    return !dryRun;
}

function isManagedHookCommand(command: unknown, agent: HookSupportedAgent): boolean {
    if (typeof command !== 'string') return false;
    if (!command.includes('0ctx connector hook ingest')) return false;
    if (agent === 'factory') {
        return command.includes('--agent=factory')
            || command.includes('--agent=antigravity');
    }
    return command.includes(`--agent=${agent}`);
}

function ensureHookEventArray(
    hooksRoot: Record<string, unknown>,
    eventName: string
): { hooks: unknown[] | null; reason: string | null } {
    const eventValue = hooksRoot[eventName];
    if (eventValue === undefined) return { hooks: [], reason: null };
    if (!Array.isArray(eventValue)) {
        return {
            hooks: null,
            reason: `hooks.${eventName} must be an array`
        };
    }
    return { hooks: eventValue, reason: null };
}

function removeManagedHookCommandsFromConfig(options: {
    configPath: string;
    agent: HookSupportedAgent;
    events: string[];
    dryRun: boolean;
}): { changed: boolean; reason: string | null } {
    const read = readJsonConfig(options.configPath);
    if (!read.exists) return { changed: false, reason: null };
    if (read.reason || !read.value) {
        return { changed: false, reason: read.reason ?? 'config file must be a JSON object' };
    }

    const config = read.value;
    const hooksValue = config.hooks;
    if (hooksValue === undefined) return { changed: false, reason: null };
    if (!isRecord(hooksValue)) {
        return { changed: false, reason: 'hooks must be a JSON object' };
    }

    const hooksRoot = { ...hooksValue } as Record<string, unknown>;
    let changed = false;

    for (const eventName of options.events) {
        const eventGroups = ensureHookEventArray(hooksRoot, eventName);
        if (eventGroups.reason) {
            return { changed: false, reason: eventGroups.reason };
        }

        const nextGroups: unknown[] = [];
        let eventChanged = false;
        for (const group of eventGroups.hooks ?? []) {
            if (!isRecord(group)) {
                nextGroups.push(group);
                continue;
            }
            const hookEntries = group.hooks;
            if (hookEntries === undefined) {
                nextGroups.push(group);
                continue;
            }
            if (!Array.isArray(hookEntries)) {
                return {
                    changed: false,
                    reason: `hooks.${eventName} entries must include a hooks array`
                };
            }
            const filteredEntries = hookEntries.filter(entry => {
                if (!isRecord(entry)) return true;
                if (entry.type !== 'command') return true;
                return !isManagedHookCommand(entry.command, options.agent);
            });
            if (filteredEntries.length !== hookEntries.length) {
                eventChanged = true;
            }
            if (filteredEntries.length === 0) {
                if (hookEntries.length > 0) eventChanged = true;
                continue;
            }
            nextGroups.push(filteredEntries.length === hookEntries.length
                ? group
                : {
                    ...group,
                    hooks: filteredEntries
                });
        }

        if (eventChanged) {
            hooksRoot[eventName] = nextGroups;
            changed = true;
        }
    }

    if (!changed) return { changed: false, reason: null };

    const nextConfig = {
        ...config,
        hooks: hooksRoot
    };
    return {
        changed: writeJsonConfig(options.configPath, nextConfig, options.dryRun),
        reason: null
    };
}

function ensureClaudeHookConfig(options: {
    configPath: string;
    contextId: string | null;
    cliCommand: string;
    dryRun: boolean;
}): HookConfigResult {
    const command = buildHookCommand('claude', process.cwd(), options.cliCommand, options.contextId);
    const read = readJsonConfig(options.configPath);
    const config: Record<string, unknown> = read.value ?? {};
    if (read.reason) {
        return {
            changed: false,
            configPath: options.configPath,
            configured: false,
            reason: read.reason
        };
    }

    const hooksValue = config.hooks;
    if (hooksValue !== undefined && !isRecord(hooksValue)) {
        return {
            changed: false,
            configPath: options.configPath,
            configured: false,
            reason: 'hooks must be a JSON object'
        };
    }

    const hooksRoot = (hooksValue ?? {}) as Record<string, unknown>;
    for (const eventName of ['Stop', 'SubagentStop'] as const) {
        const eventGroups = ensureHookEventArray(hooksRoot, eventName);
        if (eventGroups.reason) {
            return {
                changed: false,
                configPath: options.configPath,
                configured: false,
                reason: eventGroups.reason
            };
        }

        const nextEventGroups: unknown[] = [];
        for (const group of eventGroups.hooks ?? []) {
            if (!isRecord(group)) {
                nextEventGroups.push(group);
                continue;
            }
            const hookEntries = group.hooks;
            if (hookEntries === undefined) {
                nextEventGroups.push(group);
                continue;
            }
            if (!Array.isArray(hookEntries)) {
                return {
                    changed: false,
                    configPath: options.configPath,
                    configured: false,
                    reason: `hooks.${eventName} entries must include a hooks array`
                };
            }
            const filteredEntries = hookEntries.filter(entry => {
                if (!isRecord(entry)) return true;
                if (entry.type !== 'command') return true;
                return !isManagedHookCommand(entry.command, 'claude');
            });
            if (filteredEntries.length === 0) {
                continue;
            }
            nextEventGroups.push({
                ...group,
                hooks: filteredEntries
            });
        }

        nextEventGroups.push({
            hooks: [
                {
                    type: 'command',
                    command
                }
            ]
        });

        hooksRoot[eventName] = nextEventGroups;
    }
    config.hooks = hooksRoot;

    return {
        changed: writeJsonConfig(options.configPath, config, options.dryRun),
        configPath: options.configPath,
        configured: true,
        reason: null
    };
}

function getClaudeProjectConfigPath(projectRoot: string): string {
    return path.join(projectRoot, '.claude', 'settings.local.json');
}

export function getClaudeGlobalConfigPath(): string {
    return path.join(os.homedir(), '.claude', 'settings.json');
}

function ensureFactoryHookConfig(options: {
    projectRoot: string;
    contextId: string | null;
    cliCommand: string;
    dryRun: boolean;
}): HookConfigResult {
    const configPath = path.join(options.projectRoot, '.factory', 'settings.json');
    const command = buildHookCommand('factory', options.projectRoot, options.cliCommand, options.contextId);
    const read = readJsonConfig(configPath);
    const config: Record<string, unknown> = read.value ?? {};
    if (read.reason) {
        return {
            changed: false,
            configPath,
            configured: false,
            reason: read.reason
        };
    }

    const hooksValue = config.hooks;
    if (hooksValue !== undefined && !isRecord(hooksValue)) {
        return {
            changed: false,
            configPath,
            configured: false,
            reason: 'hooks must be a JSON object'
        };
    }

    const hooksRoot = (hooksValue ?? {}) as Record<string, unknown>;
    for (const eventName of ['Stop', 'SubagentStop'] as const) {
        const eventGroups = ensureHookEventArray(hooksRoot, eventName);
        if (eventGroups.reason) {
            return {
                changed: false,
                configPath,
                configured: false,
                reason: eventGroups.reason
            };
        }

        const nextEventGroups: unknown[] = [];
        for (const group of eventGroups.hooks ?? []) {
            if (!isRecord(group)) {
                nextEventGroups.push(group);
                continue;
            }
            const hookEntries = group.hooks;
            if (hookEntries === undefined) {
                nextEventGroups.push(group);
                continue;
            }
            if (!Array.isArray(hookEntries)) {
                return {
                    changed: false,
                    configPath,
                    configured: false,
                    reason: `hooks.${eventName} entries must include a hooks array`
                };
            }
            const filteredEntries = hookEntries.filter(entry => {
                if (!isRecord(entry)) return true;
                if (entry.type !== 'command') return true;
                return !isManagedHookCommand(entry.command, 'factory');
            });
            if (filteredEntries.length === 0) {
                continue;
            }
            nextEventGroups.push({
                ...group,
                hooks: filteredEntries
            });
        }

        nextEventGroups.push({
            hooks: [
                {
                    type: 'command',
                    command
                }
            ]
        });
        hooksRoot[eventName] = nextEventGroups;
    }

    config.hooks = hooksRoot;
    const primaryChanged = writeJsonConfig(configPath, config, options.dryRun);
    const cleanupTargets = [
        path.join(options.projectRoot, '.factory', 'settings.local.json'),
        path.join(os.homedir(), '.factory', 'settings.json'),
        path.join(os.homedir(), '.factory', 'settings.local.json')
    ].filter(candidate => path.resolve(candidate) !== path.resolve(configPath));

    let cleanupChanged = false;
    for (const cleanupPath of cleanupTargets) {
        const cleanup = removeManagedHookCommandsFromConfig({
            configPath: cleanupPath,
            agent: 'factory',
            events: ['Stop', 'SubagentStop'],
            dryRun: options.dryRun
        });
        cleanupChanged = cleanupChanged || cleanup.changed;
    }

    return {
        changed: primaryChanged || cleanupChanged,
        configPath,
        configured: true,
        reason: null
    };
}

function ensureAntigravityHookConfig(options: {
    projectRoot: string;
    contextId: string | null;
    cliCommand: string;
    dryRun: boolean;
}): HookConfigResult {
    const configPath = path.join(options.projectRoot, '.gemini', 'settings.json');
    const command = buildHookCommand('antigravity', options.projectRoot, options.cliCommand, options.contextId);
    const read = readJsonConfig(configPath);
    const config: Record<string, unknown> = read.value ?? {};
    if (read.reason) {
        return {
            changed: false,
            configPath,
            configured: false,
            reason: read.reason
        };
    }

    const hooksValue = config.hooks;
    if (hooksValue !== undefined && !isRecord(hooksValue)) {
        return {
            changed: false,
            configPath,
            configured: false,
            reason: 'hooks must be a JSON object'
        };
    }

    const hooksRoot = (hooksValue ?? {}) as Record<string, unknown>;
    for (const eventName of ['Stop', 'SubagentStop'] as const) {
        const eventGroups = ensureHookEventArray(hooksRoot, eventName);
        if (eventGroups.reason) {
            return {
                changed: false,
                configPath,
                configured: false,
                reason: eventGroups.reason
            };
        }

        const nextEventGroups: unknown[] = [];
        for (const group of eventGroups.hooks ?? []) {
            if (!isRecord(group)) {
                nextEventGroups.push(group);
                continue;
            }
            const hookEntries = group.hooks;
            if (hookEntries === undefined) {
                nextEventGroups.push(group);
                continue;
            }
            if (!Array.isArray(hookEntries)) {
                return {
                    changed: false,
                    configPath,
                    configured: false,
                    reason: `hooks.${eventName} entries must include a hooks array`
                };
            }
            const filteredEntries = hookEntries.filter(entry => {
                if (!isRecord(entry)) return true;
                if (entry.type !== 'command') return true;
                return !isManagedHookCommand(entry.command, 'antigravity');
            });
            if (filteredEntries.length === 0) {
                continue;
            }
            nextEventGroups.push({
                ...group,
                hooks: filteredEntries
            });
        }

        nextEventGroups.push({
            matcher: '*',
            hooks: [
                {
                    type: 'command',
                    command
                }
            ]
        });
        hooksRoot[eventName] = nextEventGroups;
    }

    config.hooks = hooksRoot;
    const primaryChanged = writeJsonConfig(configPath, config, options.dryRun);
    const cleanupTargets = [
        path.join(options.projectRoot, '.gemini', 'settings.local.json'),
        path.join(os.homedir(), '.gemini', 'settings.json'),
        path.join(os.homedir(), '.gemini', 'settings.local.json')
    ].filter(candidate => path.resolve(candidate) !== path.resolve(configPath));

    let cleanupChanged = false;
    for (const cleanupPath of cleanupTargets) {
        const cleanup = removeManagedHookCommandsFromConfig({
            configPath: cleanupPath,
            agent: 'antigravity',
            events: ['Stop', 'SubagentStop'],
            dryRun: options.dryRun
        });
        cleanupChanged = cleanupChanged || cleanup.changed;
    }

    return {
        changed: primaryChanged || cleanupChanged,
        configPath,
        configured: true,
        reason: null
    };
}

function ensureSimpleEventHookConfig(options: {
    projectRoot: string;
    contextId: string | null;
    cliCommand: string;
    dryRun: boolean;
    agent: HookSupportedAgent;
    configPath: string;
    eventName: string;
    ensureVersion?: boolean;
}): HookConfigResult {
    const command = buildHookCommand(options.agent, options.projectRoot, options.cliCommand, options.contextId);
    const read = readJsonConfig(options.configPath);
    const config: Record<string, unknown> = read.value ?? {};
    if (read.reason) {
        return {
            changed: false,
            configPath: options.configPath,
            configured: false,
            reason: read.reason
        };
    }

    const hooksValue = config.hooks;
    if (hooksValue !== undefined && !isRecord(hooksValue)) {
        return {
            changed: false,
            configPath: options.configPath,
            configured: false,
            reason: 'hooks must be a JSON object'
        };
    }

    const hooksRoot = (hooksValue ?? {}) as Record<string, unknown>;
    const eventEntries = ensureHookEventArray(hooksRoot, options.eventName);
    if (eventEntries.reason) {
        return {
            changed: false,
            configPath: options.configPath,
            configured: false,
            reason: eventEntries.reason
        };
    }

    const filteredEntries = (eventEntries.hooks ?? []).filter(entry => {
        if (!isRecord(entry)) return true;
        return !isManagedHookCommand(entry.command, options.agent);
    });
    filteredEntries.push({
        command
    });

    hooksRoot[options.eventName] = filteredEntries;
    config.hooks = hooksRoot;
    if (options.ensureVersion && typeof config.version !== 'number') {
        config.version = 1;
    }

    return {
        changed: writeJsonConfig(options.configPath, config, options.dryRun),
        configPath: options.configPath,
        configured: true,
        reason: null
    };
}

function ensureWindsurfHookConfig(options: {
    projectRoot: string;
    contextId: string | null;
    cliCommand: string;
    dryRun: boolean;
}): HookConfigResult {
    const configPath = path.join(options.projectRoot, '.windsurf', 'hooks.json');
    const responseHook = ensureSimpleEventHookConfig({
        ...options,
        agent: 'windsurf',
        configPath,
        eventName: 'post_cascade_response'
    });
    if (!responseHook.configured) {
        return responseHook;
    }
    const promptHook = ensureSimpleEventHookConfig({
        ...options,
        agent: 'windsurf',
        configPath,
        eventName: 'pre_user_prompt'
    });
    return {
        changed: responseHook.changed || promptHook.changed,
        configPath,
        configured: responseHook.configured && promptHook.configured,
        reason: responseHook.reason ?? promptHook.reason
    };
}

function ensureCursorHookConfig(options: {
    projectRoot: string;
    contextId: string | null;
    cliCommand: string;
    dryRun: boolean;
}): HookConfigResult {
    return ensureSimpleEventHookConfig({
        ...options,
        agent: 'cursor',
        configPath: path.join(options.projectRoot, '.cursor', 'hooks.json'),
        eventName: 'afterAgentResponse',
        ensureVersion: true
    });
}

function buildHookProjectConfig(state: HookInstallState): Record<string, unknown> {
    const hooks = state.agents
        .filter(agent => agent.installed)
        .map(agent => ({
            agent: agent.agent,
            command: agent.command,
            mode: 'post-chat'
        }));

    return {
        version: 1,
        generatedAt: state.updatedAt,
        projectRoot: state.projectRoot,
        contextId: state.contextId,
        hooks
    };
}

export function getHookStatePath(): string {
    return process.env.CTX_HOOK_STATE_PATH || path.join(os.homedir(), '.0ctx', 'hooks-state.json');
}

export function getHookConfigPath(projectRoot: string, agent: HookSupportedAgent): string {
    switch (agent) {
        case 'claude':
            return path.join(projectRoot, '.claude', 'settings.local.json');
        case 'windsurf':
            return path.join(projectRoot, '.windsurf', 'hooks.json');
        case 'cursor':
            return path.join(projectRoot, '.cursor', 'hooks.json');
        case 'factory':
            return path.join(projectRoot, '.factory', 'settings.json');
        case 'antigravity':
            return path.join(projectRoot, '.gemini', 'settings.json');
        case 'codex':
            return path.join(projectRoot, '.codex', 'config.toml');
        default:
            return path.join(projectRoot, '.0ctx', 'settings.local.json');
    }
}

export function readHookInstallState(now = Date.now()): HookInstallState {
    const statePath = getHookStatePath();
    if (!fs.existsSync(statePath)) {
        return {
            version: 1,
            updatedAt: now,
            projectRoot: null,
            contextId: null,
            projectConfigPath: null,
            agents: defaultHookAgents(now)
        };
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<HookInstallState>;
        const parsedAgents = Array.isArray(parsed.agents) ? parsed.agents : [];
        const agents: HookAgentState[] = [];
        for (const base of defaultHookAgents(now)) {
            const matched = parsedAgents.find(agent => agent?.agent === base.agent);
            agents.push({
                agent: base.agent,
                status: matched?.status === 'Supported' || matched?.status === 'Planned' || matched?.status === 'Skipped'
                    ? matched.status
                    : base.status,
                installed: matched?.installed === true,
                command: typeof matched?.command === 'string' ? matched.command : null,
                updatedAt: typeof matched?.updatedAt === 'number' ? matched.updatedAt : base.updatedAt,
                notes: typeof matched?.notes === 'string' ? matched.notes : base.notes
            });
        }

        return {
            version: 1,
            updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : now,
            projectRoot: typeof parsed.projectRoot === 'string' ? parsed.projectRoot : null,
            contextId: typeof parsed.contextId === 'string' ? parsed.contextId : null,
            projectConfigPath: typeof parsed.projectConfigPath === 'string' ? parsed.projectConfigPath : null,
            agents
        };
    } catch {
        return {
            version: 1,
            updatedAt: now,
            projectRoot: null,
            contextId: null,
            projectConfigPath: null,
            agents: defaultHookAgents(now)
        };
    }
}

export function installHooks(options: {
    projectRoot: string;
    contextId?: string | null;
    clients: string[];
    dryRun?: boolean;
    now?: number;
    cliCommand?: string;
    installClaudeGlobal?: boolean;
}): HookInstallResult {
    const now = options.now ?? Date.now();
    const projectRoot = path.resolve(options.projectRoot);
    const projectConfigPath = path.join(projectRoot, '.0ctx', 'settings.local.json');
    const statePath = getHookStatePath();
    const dryRun = options.dryRun === true;
    const cliCommand = options.cliCommand ?? '0ctx';
    const contextId = options.contextId ?? null;
    const installClaudeGlobal = options.installClaudeGlobal === true;
    const existingState = fs.existsSync(statePath) ? readHookInstallState(now) : null;

    const selectedClients = new Set<HookAgent>();
    for (const client of options.clients) {
        const normalized = normalizeClient(client);
        if (normalized) selectedClients.add(normalized);
    }

    const claudeHook = selectedClients.has('claude')
        ? ensureClaudeHookConfig({
            configPath: getClaudeProjectConfigPath(projectRoot),
            contextId,
            cliCommand,
            dryRun
        })
        : {
            changed: false,
            configPath: getClaudeProjectConfigPath(projectRoot),
            configured: false,
            reason: 'claude-not-selected'
        };
    const claudeGlobalHook = selectedClients.has('claude') && installClaudeGlobal
        ? ensureClaudeHookConfig({
            configPath: getClaudeGlobalConfigPath(),
            contextId: null,
            cliCommand,
            dryRun
        })
        : {
            changed: false,
            configPath: getClaudeGlobalConfigPath(),
            configured: false,
            reason: installClaudeGlobal ? 'claude-not-selected' : 'claude-global-not-selected'
        };
    const windsurfHook = selectedClients.has('windsurf')
        ? ensureWindsurfHookConfig({
            projectRoot,
            contextId,
            cliCommand,
            dryRun
        })
        : {
            changed: false,
            configPath: path.join(projectRoot, '.windsurf', 'hooks.json'),
            configured: false,
            reason: 'windsurf-not-selected'
        };
    const cursorHook = selectedClients.has('cursor')
        ? ensureCursorHookConfig({
            projectRoot,
            contextId,
            cliCommand,
            dryRun
        })
        : {
            changed: false,
            configPath: path.join(projectRoot, '.cursor', 'hooks.json'),
            configured: false,
            reason: 'cursor-not-selected'
        };
    const factoryHook = selectedClients.has('factory')
        ? ensureFactoryHookConfig({
            projectRoot,
            contextId,
            cliCommand,
            dryRun
        })
        : {
            changed: false,
            configPath: path.join(projectRoot, '.factory', 'settings.json'),
            configured: false,
            reason: 'factory-not-selected'
        };
    const antigravityHook = selectedClients.has('antigravity')
        ? ensureAntigravityHookConfig({
            projectRoot,
            contextId,
            cliCommand,
            dryRun
        })
        : {
            changed: false,
            configPath: path.join(projectRoot, '.gemini', 'settings.json'),
            configured: false,
            reason: 'antigravity-not-selected'
        };
    const codexNotify = selectedClients.has('codex')
        ? ensureCodexNotifyConfig({
            projectRoot,
            contextId,
            cliCommand,
            dryRun
        })
        : {
            changed: false,
            configPath: path.join(projectRoot, '.codex', 'config.toml'),
            configured: false,
            reason: 'codex-not-selected'
        };

    const hookConfigsByAgent: Record<HookSupportedAgent, HookConfigResult> = {
        claude: claudeHook,
        windsurf: windsurfHook,
        cursor: cursorHook,
        factory: factoryHook,
        antigravity: antigravityHook,
        codex: codexNotify
    };

    const warnings: string[] = [];
    if (selectedClients.has('claude') && !claudeHook.configured) {
        warnings.push(`Claude hook was not configured: ${claudeHook.reason ?? 'unknown reason'}.`);
    }
    if (selectedClients.has('claude') && installClaudeGlobal && !claudeGlobalHook.configured) {
        warnings.push(`Claude global hook was not configured: ${claudeGlobalHook.reason ?? 'unknown reason'}.`);
    }
    if (selectedClients.has('windsurf') && !windsurfHook.configured) {
        warnings.push(`Windsurf hook was not configured: ${windsurfHook.reason ?? 'unknown reason'}.`);
    }
    if (selectedClients.has('cursor') && !cursorHook.configured) {
        warnings.push(`Cursor hook was not configured: ${cursorHook.reason ?? 'unknown reason'}.`);
    }
    if (selectedClients.has('factory') && !factoryHook.configured) {
        warnings.push(`Factory hook was not configured: ${factoryHook.reason ?? 'unknown reason'}.`);
    }
    if (selectedClients.has('antigravity') && !antigravityHook.configured) {
        warnings.push(`Antigravity hook was not configured: ${antigravityHook.reason ?? 'unknown reason'}.`);
    }
    if (selectedClients.has('codex') && !codexNotify.configured) {
        warnings.push(`Codex notify was not configured: ${codexNotify.reason ?? 'unknown reason'}.`);
    }

    const agents = defaultHookAgents(now).map((agent): HookAgentState => {
        const previous = existingState?.agents.find(item => item.agent === agent.agent);
        const supportedAgent = agent.agent as HookSupportedAgent;
        const selected = selectedClients.has(supportedAgent);
        const installResult = hookConfigsByAgent[supportedAgent];
        const installed = selected && installResult.configured;
        const nextStatus: HookAgentState['status'] = installed ? 'Supported' : 'Skipped';
        const nextCommand = installed ? buildHookCommand(supportedAgent, projectRoot, cliCommand, contextId) : null;
        const nextNotes = !selected
            ? 'not-selected'
            : installed
                ? 'installed'
                : `not-installed: ${installResult.reason ?? 'hook-config-failed'}`;
        const unchanged = previous
            && previous.status === nextStatus
            && previous.installed === installed
            && previous.command === nextCommand
            && previous.notes === nextNotes;
        return {
            ...agent,
            status: nextStatus,
            installed,
            command: nextCommand,
            updatedAt: unchanged ? previous.updatedAt : now,
            notes: nextNotes
        };
    });

    const stateChanged = existingState
        ? existingState.projectRoot !== projectRoot
            || existingState.contextId !== contextId
            || existingState.projectConfigPath !== projectConfigPath
            || JSON.stringify(existingState.agents) !== JSON.stringify(agents)
        : true;

    const state: HookInstallState = {
        version: 1,
        updatedAt: stateChanged ? now : (existingState?.updatedAt ?? now),
        projectRoot,
        contextId,
        projectConfigPath,
        agents
    };

    let changed = false;
    if (!dryRun) {
        const persistedStateChanged = writeIfChanged(statePath, toStableJson(state));
        const projectConfig = buildHookProjectConfig(state);
        const projectChanged = writeIfChanged(projectConfigPath, toStableJson(projectConfig));
        changed = persistedStateChanged
            || projectChanged
            || claudeHook.changed
            || claudeGlobalHook.changed
            || windsurfHook.changed
            || cursorHook.changed
            || factoryHook.changed
            || antigravityHook.changed
            || codexNotify.changed;
    }

    return {
        changed,
        dryRun,
        statePath,
        projectRoot,
        contextId,
        projectConfigPath,
        claudeConfigPath: claudeHook.configPath,
        claudeHookConfigured: claudeHook.configured,
        claudeHookReason: claudeHook.reason,
        claudeGlobalConfigPath: claudeGlobalHook.configPath,
        claudeGlobalHookConfigured: claudeGlobalHook.configured,
        claudeGlobalHookReason: claudeGlobalHook.reason,
        windsurfConfigPath: windsurfHook.configPath,
        windsurfHookConfigured: windsurfHook.configured,
        windsurfHookReason: windsurfHook.reason,
        cursorConfigPath: cursorHook.configPath,
        cursorHookConfigured: cursorHook.configured,
        cursorHookReason: cursorHook.reason,
        factoryConfigPath: factoryHook.configPath,
        factoryHookConfigured: factoryHook.configured,
        factoryHookReason: factoryHook.reason,
        antigravityConfigPath: antigravityHook.configPath,
        antigravityHookConfigured: antigravityHook.configured,
        antigravityHookReason: antigravityHook.reason,
        codexConfigPath: codexNotify.configPath,
        codexNotifyConfigured: codexNotify.configured,
        codexNotifyReason: codexNotify.reason,
        warnings,
        state
    };
}

function getByPath(record: Record<string, unknown>, dottedPath: string): unknown {
    const parts = dottedPath.split('.');
    let current: unknown = record;
    for (const part of parts) {
        if (Array.isArray(current)) {
            const index = Number(part);
            if (!Number.isInteger(index) || index < 0 || index >= current.length) {
                return undefined;
            }
            current = current[index];
            continue;
        }
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        const value = getByPath(record, key);
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return null;
}

function pickVisibleText(record: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        const value = getByPath(record, key);
        const text = extractGenericTextParts(value).join(' ').trim();
        if (text.length > 0) {
            return text;
        }
    }
    return null;
}

function pickTimestamp(record: Record<string, unknown>, keys: string[], fallback: number): number {
    for (const key of keys) {
        const value = getByPath(record, key);
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value > 10_000_000_000 ? value : value * 1000;
        }
        if (typeof value === 'string' && value.trim().length > 0) {
            const parsed = Date.parse(value.trim());
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
    }
    return fallback;
}

function compactTranscriptText(value: string): string | null {
    const withoutReminders = value
        .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return withoutReminders.length > 0 ? withoutReminders : null;
}

function extractTranscriptTextParts(value: unknown): string[] {
    if (typeof value === 'string') {
        const compact = compactTranscriptText(value);
        return compact ? [compact] : [];
    }
    if (!Array.isArray(value)) return [];

    const parts: string[] = [];
    for (const item of value) {
        if (!isRecord(item)) continue;
        if (item.type !== 'text') continue;
        const compact = typeof item.text === 'string' ? compactTranscriptText(item.text) : null;
        if (compact) {
            parts.push(compact);
        }
    }
    return parts;
}

function extractGenericTextParts(value: unknown): string[] {
    if (typeof value === 'string') {
        const compact = compactTranscriptText(value);
        return compact ? [compact] : [];
    }
    if (Array.isArray(value)) {
        return value.flatMap(item => extractGenericTextParts(item));
    }
    if (!isRecord(value)) return [];

    if (typeof value.type === 'string' && value.type !== 'text' && value.type !== 'message' && value.type !== 'input') {
        if (value.type === 'thinking' || value.type === 'tool_result') {
            return [];
        }
    }

    const parts: string[] = [];
    if (typeof value.text === 'string') {
        const compact = compactTranscriptText(value.text);
        if (compact) parts.push(compact);
    }
    if ('content' in value) {
        parts.push(...extractGenericTextParts(value.content));
    }
    if ('message' in value) {
        parts.push(...extractGenericTextParts(value.message));
    }
    return parts;
}

function normalizeCodexRole(value: unknown): string {
    if (typeof value !== 'string') return 'user';
    const role = value.trim().toLowerCase();
    if (role === 'assistant' || role === 'user' || role === 'system' || role === 'tool') {
        return role;
    }
    return 'user';
}

function selectCodexUserMessage(raw: Record<string, unknown>): {
    role: string;
    text: string;
    occurredAt: number | null;
    raw: Record<string, unknown> | string;
} | null {
    const inputs = getByPath(raw, 'input-messages') ?? getByPath(raw, 'input_messages');
    if (!Array.isArray(inputs) || inputs.length === 0) return null;

    for (let index = inputs.length - 1; index >= 0; index -= 1) {
        const item = inputs[index];
        if (typeof item === 'string') {
            const text = compactTranscriptText(item);
            if (!text) continue;
            return {
                role: 'user',
                text,
                occurredAt: null,
                raw: item
            };
        }
        if (!isRecord(item)) continue;
        const role = normalizeCodexRole(item.role ?? item.actor ?? item.speaker);
        const text = extractGenericTextParts(item.content ?? item.text ?? item.message).join(' ').trim();
        if (!text) continue;
        return {
            role,
            text,
            occurredAt: pickTimestamp(item, ['timestamp', 'createdAt', 'created_at'], Date.now()),
            raw: item
        };
    }

    return null;
}

export function readCodexCapture(
    payload: Record<string, unknown>,
    options: {
        sessionId: string;
        turnId: string;
        occurredAt: number;
    }
): TranscriptCaptureData {
    const sessionTitle = pickString(payload, ['thread-title', 'thread_title', 'title', 'sessionTitle', 'threadName']);
    const cwd = pickString(payload, ['cwd', 'workspace.cwd', 'workspace.path', 'project.path']);
    const messages: TranscriptCaptureMessage[] = [];
    const userMessage = selectCodexUserMessage(payload);
    const assistantText = pickString(payload, ['last-assistant-message', 'last_assistant_message', 'lastAssistantMessage', 'assistant_response', 'assistantResponse', 'response', 'content', 'text']);

    if (userMessage && userMessage.role !== 'system' && userMessage.role !== 'tool') {
        messages.push({
            messageId: `${options.turnId}:user`,
            role: userMessage.role,
            text: userMessage.text,
            occurredAt: userMessage.occurredAt ?? options.occurredAt,
            parentId: null,
            lineNumber: 1,
            raw: typeof userMessage.raw === 'string' ? { text: userMessage.raw } : userMessage.raw
        });
    }

    if (assistantText) {
        messages.push({
            messageId: `${options.turnId}:assistant`,
            role: 'assistant',
            text: assistantText,
            occurredAt: options.occurredAt,
            parentId: messages.length > 0 ? messages[messages.length - 1].messageId : null,
            lineNumber: messages.length + 1,
            raw: payload
        });
    }

    return {
        summary: summarizeTranscriptMessages(messages, sessionTitle),
        cwd,
        sessionTitle,
        startedAt: messages[0]?.occurredAt ?? options.occurredAt,
        messages
    };
}

export function resolveCodexSessionArchivePath(payload: Record<string, unknown>, sessionId: string): string | null {
    const explicitPath = pickString(payload, [
        'session_path',
        'sessionPath',
        'archive_path',
        'archivePath',
        'transcript_path',
        'transcriptPath'
    ]);
    if (explicitPath) {
        const resolved = path.resolve(explicitPath);
        if (fs.existsSync(resolved)) {
            return resolved;
        }
    }

    const sessionsRoot = path.join(os.homedir(), '.codex', 'sessions');
    if (!fs.existsSync(sessionsRoot)) {
        return null;
    }

    let bestMatch: { path: string; mtimeMs: number } | null = null;
    const pending = [sessionsRoot];
    while (pending.length > 0) {
        const current = pending.pop();
        if (!current) continue;
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                pending.push(fullPath);
                continue;
            }
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jsonl')) {
                continue;
            }
            if (!entry.name.includes(sessionId)) {
                continue;
            }
            let stats: fs.Stats | null = null;
            try {
                stats = fs.statSync(fullPath);
            } catch {
                stats = null;
            }
            const mtimeMs = stats?.mtimeMs ?? 0;
            if (!bestMatch || mtimeMs >= bestMatch.mtimeMs) {
                bestMatch = { path: fullPath, mtimeMs };
            }
        }
    }

    return bestMatch?.path ?? null;
}

export function readCodexArchiveCapture(
    filePath: string | null,
    options: {
        sessionId: string;
        occurredAt: number;
        sessionTitle?: string | null;
        cwd?: string | null;
    }
): TranscriptCaptureData {
    const empty = {
        summary: null,
        cwd: options.cwd ?? null,
        sessionTitle: options.sessionTitle ?? null,
        startedAt: null,
        messages: []
    };
    if (!filePath) {
        return empty;
    }

    try {
        const resolvedPath = path.resolve(filePath);
        if (!fs.existsSync(resolvedPath)) {
            return empty;
        }

        const content = fs.readFileSync(resolvedPath, 'utf8');
        let cwd: string | null = options.cwd ?? null;
        let sessionTitle: string | null = options.sessionTitle ?? null;
        const messages: TranscriptCaptureMessage[] = [];
        const usedIds = new Map<string, number>();
        let previousVisibleMessageId: string | null = null;

        for (const [index, line] of content.split(/\r?\n/).entries()) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            let parsed: unknown;
            try {
                parsed = JSON.parse(trimmed);
            } catch {
                continue;
            }
            if (!isRecord(parsed)) continue;

            const lineType = typeof parsed.type === 'string' ? parsed.type : null;
            if (lineType === 'session_meta') {
                const meta = isRecord(parsed.payload) ? parsed.payload : parsed;
                cwd = pickString(meta, ['cwd', 'workspace.cwd', 'project.path', 'projectPath']) ?? cwd;
                sessionTitle = pickString(meta, ['thread_name', 'threadName', 'title', 'session_title', 'sessionTitle']) ?? sessionTitle;
                continue;
            }

            let messageEnvelope: Record<string, unknown> | null = null;
            if (lineType === 'response_item' && isRecord(parsed.payload)) {
                messageEnvelope = parsed.payload;
            } else if (lineType === 'message' && isRecord(parsed.message)) {
                messageEnvelope = parsed.message;
            }
            if (!messageEnvelope) continue;

            const payloadType = typeof messageEnvelope.type === 'string' ? messageEnvelope.type : null;
            if (lineType === 'response_item' && payloadType !== 'message') {
                continue;
            }

            const rawRoleValue = messageEnvelope.role ?? parsed.role ?? getByPath(messageEnvelope, 'message.role');
            const rawRole = typeof rawRoleValue === 'string' ? rawRoleValue.trim().toLowerCase() : '';
            if (rawRole !== 'user' && rawRole !== 'assistant') {
                continue;
            }
            const role = normalizeCodexRole(rawRole);

            const visibleText = extractGenericTextParts(
                messageEnvelope.content ?? messageEnvelope.text ?? messageEnvelope.message
            ).join(' ').trim();
            if (!visibleText) continue;

            const baseMessageId = pickString(messageEnvelope, ['id'])
                ?? pickString(parsed, ['id'])
                ?? `${options.sessionId}:line-${index + 1}`;
            const seenCount = usedIds.get(baseMessageId) ?? 0;
            usedIds.set(baseMessageId, seenCount + 1);
            const messageId = seenCount === 0 ? baseMessageId : `${baseMessageId}-${seenCount + 1}`;
            const parentId = pickString(messageEnvelope, [
                'parent_id',
                'parentId',
                'previous_item_id',
                'previousItemId',
                'in_reply_to',
                'inReplyTo'
            ]) ?? previousVisibleMessageId;

            messages.push({
                messageId,
                role,
                text: visibleText,
                occurredAt: pickTimestamp(
                    parsed,
                    ['timestamp', 'payload.timestamp', 'payload.created_at', 'payload.createdAt'],
                    options.occurredAt
                ),
                parentId,
                lineNumber: index + 1,
                raw: parsed
            });
            previousVisibleMessageId = messageId;
        }

        return {
            summary: summarizeTranscriptMessages(messages, sessionTitle),
            cwd,
            sessionTitle,
            startedAt: messages[0]?.occurredAt ?? null,
            messages
        };
    } catch {
        return empty;
    }
}

function deriveInlineEventMode(agent: HookAgent, payload: Record<string, unknown>): 'user' | 'assistant' | 'mixed' | 'unknown' {
    const eventName = pickString(payload, [
        'hook_event_name',
        'hookEventName',
        'event',
        'agent_action_name',
        'type',
        'name'
    ])?.toLowerCase() ?? '';
    const rawRole = pickString(payload, ['role', 'message.role', 'actor', 'speaker']);
    const role = rawRole ? normalizeCodexRole(rawRole) : null;

    if (agent === 'windsurf') {
        if (eventName.includes('pre_user_prompt')) return 'user';
        if (eventName.includes('post_cascade_response')) return 'assistant';
    }

    if (agent === 'cursor') {
        if (eventName.includes('before') || eventName.includes('submitprompt')) return 'user';
        if (eventName.includes('afteragentresponse')) return 'assistant';
    }

    if (role === 'user') return 'user';
    if (role === 'assistant') return 'assistant';
    if (role === 'system' || role === 'tool') return 'unknown';
    return 'mixed';
}

export function readInlineHookCapture(
    agent: HookAgent,
    payload: Record<string, unknown>,
    options: {
        sessionId: string;
        turnId: string;
        occurredAt: number;
    }
): TranscriptCaptureData {
    const sessionTitle = pickString(payload, [
        'sessionTitle',
        'thread-title',
        'thread_title',
        'threadName',
        'conversation.title',
        'title'
    ]);
    const cwd = pickString(payload, ['cwd', 'workspace.cwd', 'workspace.path', 'project.path', 'repositoryRoot']);
    const userText = pickVisibleText(payload, [
        'tool_info.user_prompt',
        'user_prompt',
        'userPrompt',
        'prompt',
        'request.prompt',
        'input',
        'input_message',
        'input.message'
    ]);
    const assistantText = pickVisibleText(payload, [
        'last_assistant_message',
        'lastAssistantMessage',
        'last-assistant-message',
        'tool_info.response',
        'assistant_response',
        'assistantResponse',
        'completion',
        'response',
        'message.content',
        'content',
        'text'
    ]);
    const mode = deriveInlineEventMode(agent, payload);
    const startedAt = pickTimestamp(payload, ['timestamp', 'createdAt', 'created_at', 'eventAt', 'time'], options.occurredAt);
    const messages: TranscriptCaptureMessage[] = [];

    if ((mode === 'user' || mode === 'mixed') && userText) {
        messages.push({
            messageId: `${options.turnId}:user`,
            role: 'user',
            text: userText,
            occurredAt: startedAt,
            parentId: null,
            lineNumber: 1,
            raw: payload
        });
    }

    if ((mode === 'assistant' || mode === 'mixed') && assistantText) {
        messages.push({
            messageId: `${options.turnId}:assistant`,
            role: 'assistant',
            text: assistantText,
            occurredAt: options.occurredAt,
            parentId: messages[0]?.messageId ?? null,
            lineNumber: messages.length + 1,
            raw: payload
        });
    }

    return {
        summary: summarizeTranscriptMessages(messages, sessionTitle),
        cwd,
        sessionTitle,
        startedAt: messages[0]?.occurredAt ?? startedAt,
        messages
    };
}

function summarizeTranscriptMessages(messages: TranscriptCaptureMessage[], sessionTitle: string | null): string | null {
    let lastUserText: string | null = null;
    let lastAssistantText: string | null = null;

    for (const message of messages) {
        if (message.role === 'user') {
            lastUserText = message.text;
            continue;
        }
        if (message.role === 'assistant') {
            lastAssistantText = message.text;
        }
    }

    if (lastUserText && lastAssistantText) {
        return `${lastUserText} -> ${lastAssistantText}`;
    }
    return lastAssistantText ?? lastUserText ?? sessionTitle;
}

export function readTranscriptCapture(filePath: string | null): TranscriptCaptureData {
    if (!filePath) {
        return {
            summary: null,
            cwd: null,
            sessionTitle: null,
            startedAt: null,
            messages: []
        };
    }

    try {
        const resolvedPath = path.resolve(filePath);
        if (!fs.existsSync(resolvedPath)) {
            return {
                summary: null,
                cwd: null,
                sessionTitle: null,
                startedAt: null,
                messages: []
            };
        }

        const content = fs.readFileSync(resolvedPath, 'utf8');
        let cwd: string | null = null;
        let sessionTitle: string | null = null;
        const messages: TranscriptCaptureMessage[] = [];
        const usedIds = new Map<string, number>();

        for (const [index, line] of content.split(/\r?\n/).entries()) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            let parsed: unknown;
            try {
                parsed = JSON.parse(trimmed);
            } catch {
                continue;
            }
            if (!isRecord(parsed)) continue;

            const lineType = typeof parsed.type === 'string' ? parsed.type : null;
            if (lineType === 'session_start') {
                cwd = pickString(parsed, ['cwd']) ?? cwd;
                sessionTitle = pickString(parsed, ['title', 'sessionTitle']) ?? sessionTitle;
                continue;
            }

            if (lineType !== 'message') continue;
            const message = isRecord(parsed.message) ? parsed.message : null;
            if (!message) continue;

            const role = typeof message.role === 'string' ? message.role.trim().toLowerCase() : null;
            const visibleText = extractTranscriptTextParts(message.content).join(' ').trim();
            if (!visibleText) continue;

            const baseMessageId = pickString(parsed, ['id', 'message.id']) ?? `line-${index + 1}`;
            const seenCount = usedIds.get(baseMessageId) ?? 0;
            usedIds.set(baseMessageId, seenCount + 1);
            const messageId = seenCount === 0 ? baseMessageId : `${baseMessageId}-${seenCount + 1}`;

            messages.push({
                messageId,
                role: role ?? 'unknown',
                text: visibleText,
                occurredAt: pickTimestamp(parsed, ['timestamp', 'createdAt', 'created_at'], Date.now()),
                parentId: pickString(parsed, ['parentId']),
                lineNumber: index + 1,
                raw: parsed
            });
        }

        return {
            summary: summarizeTranscriptMessages(messages, sessionTitle),
            cwd,
            sessionTitle,
            startedAt: messages[0]?.occurredAt ?? null,
            messages
        };
    } catch {
        return {
            summary: null,
            cwd: null,
            sessionTitle: null,
            startedAt: null,
            messages: []
        };
    }
}

function readTranscriptSummary(filePath: string | null): {
    summary: string | null;
    cwd: string | null;
    sessionTitle: string | null;
} {
    const capture = readTranscriptCapture(filePath);
    return {
        summary: capture.summary,
        cwd: capture.cwd,
        sessionTitle: capture.sessionTitle
    };
}

export function resolveHookTranscriptPath(payload: Record<string, unknown>): string | null {
    return pickString(payload, [
        'transcript_path',
        'transcriptPath',
        'agent_transcript_path',
        'agentTranscriptPath'
    ]);
}

export function resolveHookCaptureRoot(
    agent: HookAgent,
    payload: Record<string, unknown>,
    repoRootFallback: string | null = null
): string | null {
    const rootKeys = agent === 'codex'
        ? ['cwd', 'workspace.cwd', ...GENERIC_CAPTURE_ROOT_KEYS]
        : GENERIC_CAPTURE_ROOT_KEYS;
    const rawRoot = rootKeys.length > 0 ? pickString(payload, rootKeys) : null;
    const candidate = rawRoot ?? repoRootFallback;
    if (!candidate || candidate.trim().length === 0) {
        return null;
    }
    return path.resolve(candidate);
}

export function selectHookContextId(
    contexts: Array<{ id?: string; paths?: string[] }>,
    repoRoot: string | null,
    explicitContextId: string | null
): string | null {
    if (explicitContextId) {
        const explicit = contexts.find(context => typeof context?.id === 'string' && context.id === explicitContextId);
        if (explicit?.id) {
            return explicit.id;
        }
    }

    if (repoRoot) {
        const normalizedRoot = path.resolve(repoRoot).toLowerCase();
        const byPath = contexts.find(context => (context.paths ?? []).some(rawPath => {
            const normalizedPath = path.resolve(rawPath).toLowerCase();
            return normalizedRoot === normalizedPath
                || normalizedRoot.startsWith(`${normalizedPath}${path.sep}`)
                || normalizedPath.startsWith(`${normalizedRoot}${path.sep}`);
        }));
        if (byPath?.id) {
            return byPath.id;
        }
    }

    if (contexts.length === 1) {
        return contexts[0]?.id ?? null;
    }

    return null;
}

export function matchesHookCaptureRoot(contextPaths: string[], captureRoot: string | null): boolean {
    if (!captureRoot) return true;
    if (!Array.isArray(contextPaths) || contextPaths.length === 0) return true;

    const normalizedRoot = path.resolve(captureRoot).toLowerCase();
    return contextPaths.some(rawPath => {
        const normalizedPath = path.resolve(rawPath).toLowerCase();
        return normalizedRoot === normalizedPath
            || normalizedRoot.startsWith(`${normalizedPath}${path.sep}`);
    });
}

function normalizeSummary(value: string): string {
    const compact = value.replace(/\s+/g, ' ').trim();
    if (!compact) return 'Chat turn captured';
    return compact.length > 280 ? `${compact.slice(0, 277)}...` : compact;
}

export function normalizeHookPayload(agent: HookAgent, payload: unknown, now = Date.now()): NormalizedHookPayload {
    const raw: Record<string, unknown> = (payload && typeof payload === 'object' && !Array.isArray(payload))
        ? { ...(payload as Record<string, unknown>) }
        : { payload };

    const baseSessionKeys = [
        'sessionId',
        'session_id',
        'session.id',
        'conversationId',
        'conversation_id',
        'thread',
        'threadId',
        'thread_id'
    ];
    const baseTurnKeys = [
        'turnId',
        'turn_id',
        'turn.id',
        'messageId',
        'message_id',
        'message.id',
        'generation_id',
        'generationId',
        'execution_id',
        'executionId',
        'id'
    ];
    const baseRoleKeys = ['role', 'message.role', 'actor', 'speaker'];
    const baseSummaryKeys = [
        'summary',
        'message.content',
        'content',
        'text',
        'prompt',
        'completion',
        'response',
        'stop_reason',
        'assistant_response',
        'assistantResponse',
        'tool_info.response'
    ];
    const windsurfSummaryKeys = ['tool_info.response', 'response', 'tool_info.user_prompt', ...baseSummaryKeys];
    const cursorSummaryKeys = ['response', 'text', 'content', ...baseSummaryKeys];
    const factorySummaryKeys = ['hook_event_name', 'stop_reason', ...baseSummaryKeys];
    const codexSummaryKeys = ['last-assistant-message', 'last_assistant_message', 'lastAssistantMessage', ...baseSummaryKeys];
    const claudeSummaryKeys = ['last_assistant_message', 'lastAssistantMessage', 'last-assistant-message', ...baseSummaryKeys];
    const transcriptSummary = (agent === 'factory' || agent === 'antigravity' || agent === 'claude')
        ? readTranscriptSummary(resolveHookTranscriptPath(raw))
        : { summary: null, cwd: null, sessionTitle: null };
    if (transcriptSummary.cwd && !pickString(raw, ['cwd'])) {
        raw.cwd = transcriptSummary.cwd;
    }
    if (transcriptSummary.sessionTitle && !pickString(raw, ['sessionTitle', 'title'])) {
        raw.sessionTitle = transcriptSummary.sessionTitle;
    }

    const agentSessionKeys = agent === 'windsurf'
        ? ['trajectory_id', 'conversation.id', ...baseSessionKeys]
        : agent === 'cursor'
            ? ['conversation.id', 'conversation_id', 'thread.id', ...baseSessionKeys]
        : agent === 'codex'
            ? ['thread-id', 'thread_id', 'thread.id', 'session.id', ...baseSessionKeys]
            : (agent === 'factory' || agent === 'antigravity')
                ? ['session_id', 'sessionId', ...baseSessionKeys]
            : ['conversation.id', ...baseSessionKeys];
    const agentTurnKeys = agent === 'windsurf'
        ? ['execution_id', 'executionId', 'turn.id', ...baseTurnKeys]
        : agent === 'cursor'
            ? ['generation_id', 'generationId', 'turn.id', ...baseTurnKeys]
            : agent === 'codex'
                ? ['turn-id', 'turn_id', 'turn.id', ...baseTurnKeys]
                : [...baseTurnKeys];
    const agentSummaryKeys = agent === 'windsurf'
        ? windsurfSummaryKeys
        : agent === 'cursor'
            ? cursorSummaryKeys
            : agent === 'codex'
                ? codexSummaryKeys
                : agent === 'claude'
                    ? claudeSummaryKeys
                : (agent === 'factory' || agent === 'antigravity')
                    ? factorySummaryKeys
                : baseSummaryKeys;
    const summaryFallback = agent === 'codex'
        ? pickString(raw, ['input-messages.0', 'input_messages.0'])
        : agent === 'cursor'
            ? pickString(raw, ['prompt', 'text'])
            : (agent === 'factory' || agent === 'antigravity' || agent === 'claude')
                ? transcriptSummary.summary ?? pickString(raw, ['sessionTitle', 'title'])
                : null;

    const sessionId = pickString(raw, agentSessionKeys) ?? 'default-session';
    const occurredAt = pickTimestamp(
        raw,
        ['timestamp', 'createdAt', 'created_at', 'time', 'eventAt', 'event_at', 'tool_info.timestamp'],
        now
    );
    const turnId = pickString(raw, agentTurnKeys) ?? `turn-${occurredAt}`;
    const windsurfAction = pickString(raw, ['agent_action_name', 'event']);
    const defaultRole = (agent === 'claude' || agent === 'codex' || agent === 'cursor' || agent === 'factory' || agent === 'antigravity')
        ? 'assistant'
        : (agent === 'windsurf' && windsurfAction?.startsWith('post_cascade_response'))
            ? 'assistant'
            : 'unknown';
    const role = pickString(raw, baseRoleKeys) ?? defaultRole;
    const summarySource = (agent === 'factory' || agent === 'antigravity' || agent === 'claude')
        ? summaryFallback ?? pickString(raw, agentSummaryKeys)
        : pickString(raw, agentSummaryKeys) ?? summaryFallback;
    const summary = normalizeSummary(summarySource ?? JSON.stringify(raw));
    return {
        agent,
        sessionId,
        turnId,
        role,
        summary,
        occurredAt,
        raw
    };
}
