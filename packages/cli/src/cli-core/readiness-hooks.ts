import fs from 'fs';
import path from 'path';
import { isGaHookAgent } from './clients';
import { getHookConfigPath, type HookSupportedAgent } from '../hooks';
import type { HookHealthAgentCheck, HookHealthDetails } from './types';

interface ManagedProjectHookConfig {
    projectRoot: string | null;
    contextId: string | null;
    agents: Array<{ agent: HookSupportedAgent; command: string | null }>;
}

export function isHookCommandPresent(agent: HookSupportedAgent, configContent: string, expectedCommand: string | null): boolean {
    if (agent === 'codex') {
        return configContent.includes('# BEGIN 0ctx-codex-notify')
            && configContent.includes('# END 0ctx-codex-notify')
            && configContent.includes('--agent=codex');
    }

    if (!expectedCommand) return false;
    const hasManagedHookPrefix = configContent.includes('0ctx hook ingest') || configContent.includes('0ctx connector hook ingest');
    return hasManagedHookPrefix
        && configContent.includes(`--agent=${agent}`)
        && configContent.includes(expectedCommand.replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' '));
}

export function isSessionStartCommandPresent(agent: HookSupportedAgent, configContent: string): boolean {
    if (agent !== 'claude' && agent !== 'factory' && agent !== 'antigravity') {
        return false;
    }

    return configContent.includes('SessionStart')
        && (configContent.includes('0ctx hook session-start') || configContent.includes('0ctx connector hook session-start'))
        && configContent.includes(`--agent=${agent}`);
}

export function normalizeRepoIdentity(input: string | null | undefined): string | null {
    if (typeof input !== 'string' || input.trim().length === 0) {
        return null;
    }
    const normalized = path.normalize(path.resolve(input));
    return process.platform === 'win32'
        ? normalized.toLowerCase()
        : normalized;
}

export function buildDataPolicyActionHint(policy: {
    syncPolicy?: string | null;
    captureRetentionDays?: number;
    debugRetentionDays?: number;
    debugArtifactsEnabled?: boolean;
    preset?: string | null;
} | null | undefined): string | null {
    const syncPolicy = String(policy?.syncPolicy || '').trim().toLowerCase();
    const preset = String(policy?.preset || '').trim().toLowerCase();
    const captureRetentionDays = typeof policy?.captureRetentionDays === 'number' ? policy.captureRetentionDays : 14;
    const debugRetentionDays = typeof policy?.debugRetentionDays === 'number' ? policy.debugRetentionDays : 7;
    const debugArtifactsEnabled = policy?.debugArtifactsEnabled === true;

    if (preset === 'custom') {
        return 'Normalize workspace sync and machine capture with 0ctx data-policy lean, review, or debug.';
    }
    if (preset === 'shared' || syncPolicy === 'full_sync') {
        return 'Return this workspace to Lean to clear legacy remote-sync settings.';
    }
    if (preset === 'debug' || debugArtifactsEnabled) {
        return 'Return this machine to Lean when troubleshooting is complete.';
    }
    if (preset === 'review' || captureRetentionDays > 14 || debugRetentionDays > 7) {
        return 'Return this machine to Lean when the longer local review window is no longer needed.';
    }
    return null;
}

export function resolveRepoScopedHookDetails(options: {
    repoRoot: string;
    fallback: HookHealthDetails;
}): HookHealthDetails {
    const repoRoot = path.resolve(options.repoRoot);
    const projectConfigPath = path.join(repoRoot, '.0ctx', 'settings.local.json');
    const managedProject = readManagedProjectHookConfig(projectConfigPath);
    const normalizedRepoRoot = normalizeRepoIdentity(repoRoot);
    const normalizedManagedRoot = normalizeRepoIdentity(managedProject?.projectRoot ?? repoRoot);

    if (!managedProject || managedProject.agents.length === 0 || normalizedManagedRoot !== normalizedRepoRoot) {
        return options.fallback;
    }

    const allAgents = managedProject.agents.map((agentState): HookHealthAgentCheck => {
        const configPath = getHookConfigPath(repoRoot, agentState.agent);
        const configExists = fs.existsSync(configPath);
        const content = configExists ? fs.readFileSync(configPath, 'utf8') : '';
        return {
            agent: agentState.agent,
            configPath,
            configExists,
            commandPresent: configExists && isHookCommandPresent(agentState.agent, content, agentState.command),
            sessionStartPresent: configExists && isSessionStartCommandPresent(agentState.agent, content),
            command: agentState.command
        };
    });
    const agents = allAgents.filter((agent) => isGaHookAgent(agent.agent));
    const previewAgents = allAgents.filter((agent) => !isGaHookAgent(agent.agent));

    return {
        ...options.fallback,
        projectRoot: repoRoot,
        projectRootExists: fs.existsSync(repoRoot),
        projectConfigPath,
        projectConfigExists: fs.existsSync(projectConfigPath),
        contextId: managedProject.contextId,
        contextIdExists: managedProject.contextId === options.fallback.contextId
            ? options.fallback.contextIdExists
            : null,
        installedAgentCount: agents.length,
        agents,
        previewInstalledAgentCount: previewAgents.length,
        previewAgents
    };
}

function readManagedProjectHookConfig(projectConfigPath: string): ManagedProjectHookConfig | null {
    if (!fs.existsSync(projectConfigPath)) {
        return null;
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8')) as Record<string, unknown>;
        const rawHooks = Array.isArray(parsed.hooks) ? parsed.hooks : [];
        const agents = rawHooks
            .map((entry) => parseManagedHookAgent(entry))
            .filter((entry): entry is { agent: HookSupportedAgent; command: string | null } => Boolean(entry));

        return {
            projectRoot: typeof parsed.projectRoot === 'string' ? parsed.projectRoot : null,
            contextId: typeof parsed.contextId === 'string' ? parsed.contextId : null,
            agents
        };
    } catch {
        return null;
    }
}

function parseManagedHookAgent(value: unknown): { agent: HookSupportedAgent; command: string | null } | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const entry = value as Record<string, unknown>;
    const agent = parseHookSupportedAgent(entry.agent);
    if (!agent) {
        return null;
    }

    return {
        agent,
        command: typeof entry.command === 'string' ? entry.command : null
    };
}

function parseHookSupportedAgent(value: unknown): HookSupportedAgent | null {
    return value === 'claude' || value === 'windsurf' || value === 'codex' || value === 'cursor' || value === 'factory' || value === 'antigravity'
        ? value
        : null;
}
