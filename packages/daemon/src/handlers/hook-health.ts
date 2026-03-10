import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    getHookDebugRetentionDays,
    getHookDumpRetentionDays,
    isHookDebugArtifactsEnabled
} from '../data-policy';

type HookHealthAgent = {
    agent: string;
    status: 'Supported' | 'Planned' | 'Skipped';
    installed: boolean;
    command: string | null;
    sessionStartInstalled: boolean;
    updatedAt: number | null;
    notes: string | null;
};

function getHookConfigPathForAgent(projectRoot: string, agent: string): string | null {
    switch (agent) {
        case 'claude':
            return path.join(projectRoot, '.claude', 'settings.local.json');
        case 'factory':
            return path.join(projectRoot, '.factory', 'settings.json');
        case 'antigravity':
            return path.join(projectRoot, '.gemini', 'settings.json');
        case 'windsurf':
            return path.join(projectRoot, '.windsurf', 'settings.json');
        case 'cursor':
            return path.join(projectRoot, '.cursor', 'settings.json');
        case 'codex':
            return path.join(projectRoot, '.codex', 'config.toml');
        default:
            return null;
    }
}

function isSessionStartConfigured(projectRoot: string | null, agent: string): boolean {
    if (!projectRoot || (agent !== 'claude' && agent !== 'factory' && agent !== 'antigravity')) {
        return false;
    }
    const configPath = getHookConfigPathForAgent(projectRoot, agent);
    if (!configPath || !fs.existsSync(configPath)) {
        return false;
    }
    try {
        const content = fs.readFileSync(configPath, 'utf8');
        return content.includes('SessionStart')
            && content.includes('0ctx connector hook session-start')
            && content.includes(`--agent=${agent}`);
    } catch {
        return false;
    }
}

function getHookStatePath(): string {
    return process.env.CTX_HOOK_STATE_PATH || path.join(os.homedir(), '.0ctx', 'hooks-state.json');
}

export function readHookHealth(): {
    statePath: string;
    projectRoot: string | null;
    contextId: string | null;
    projectConfigPath: string | null;
    updatedAt: number | null;
    capturePolicy: {
        captureRetentionDays: number;
        debugRetentionDays: number;
        debugArtifactsEnabled: boolean;
    };
    agents: HookHealthAgent[];
} {
    const defaults: HookHealthAgent[] = [
        { agent: 'claude', status: 'Skipped', installed: false, command: null, sessionStartInstalled: false, updatedAt: null, notes: 'supported' },
        { agent: 'windsurf', status: 'Skipped', installed: false, command: null, sessionStartInstalled: false, updatedAt: null, notes: 'preview-hook' },
        { agent: 'codex', status: 'Skipped', installed: false, command: null, sessionStartInstalled: false, updatedAt: null, notes: 'preview-notify-archive' },
        { agent: 'cursor', status: 'Skipped', installed: false, command: null, sessionStartInstalled: false, updatedAt: null, notes: 'preview-hook' },
        { agent: 'factory', status: 'Skipped', installed: false, command: null, sessionStartInstalled: false, updatedAt: null, notes: 'supported' },
        { agent: 'antigravity', status: 'Skipped', installed: false, command: null, sessionStartInstalled: false, updatedAt: null, notes: 'supported' }
    ];

    const statePath = getHookStatePath();
    const capturePolicy = {
        captureRetentionDays: getHookDumpRetentionDays(),
        debugRetentionDays: getHookDebugRetentionDays(),
        debugArtifactsEnabled: isHookDebugArtifactsEnabled()
    };

    if (!fs.existsSync(statePath)) {
        return {
            statePath,
            projectRoot: null,
            contextId: null,
            projectConfigPath: null,
            updatedAt: null,
            capturePolicy,
            agents: defaults
        };
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>;
        const projectRoot = typeof parsed.projectRoot === 'string' ? parsed.projectRoot : null;
        const agents = Array.isArray(parsed.agents)
            ? (parsed.agents as Array<Record<string, unknown>>).map((entry): HookHealthAgent => ({
                agent: typeof entry.agent === 'string' ? entry.agent : 'unknown',
                status: entry.status === 'Supported' || entry.status === 'Planned' || entry.status === 'Skipped'
                    ? entry.status
                    : 'Skipped',
                installed: entry.installed === true,
                command: typeof entry.command === 'string' ? entry.command : null,
                sessionStartInstalled: isSessionStartConfigured(projectRoot, typeof entry.agent === 'string' ? entry.agent : ''),
                updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : null,
                notes: typeof entry.notes === 'string' ? entry.notes : null
            }))
            : defaults;
        return {
            statePath,
            projectRoot,
            contextId: typeof parsed.contextId === 'string' ? parsed.contextId : null,
            projectConfigPath: typeof parsed.projectConfigPath === 'string' ? parsed.projectConfigPath : null,
            updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : null,
            capturePolicy,
            agents
        };
    } catch {
        return {
            statePath,
            projectRoot: null,
            contextId: null,
            projectConfigPath: null,
            updatedAt: null,
            capturePolicy,
            agents: defaults
        };
    }
}
