import fs from 'fs';
import path from 'path';

type GaHookAgent = 'claude' | 'factory' | 'antigravity';

type ManagedHookEntry = {
    agent: GaHookAgent;
    command: string | null;
};

type ManagedProjectHookConfig = {
    projectRoot: string | null;
    contextId: string | null;
    agents: ManagedHookEntry[];
};

const GA_HOOK_AGENTS: GaHookAgent[] = ['claude', 'factory', 'antigravity'];

function parseGaHookAgent(value: unknown): GaHookAgent | null {
    return value === 'claude' || value === 'factory' || value === 'antigravity'
        ? value
        : null;
}

export function normalizeRepoIdentity(input: string | null | undefined): string | null {
    if (typeof input !== 'string' || input.trim().length === 0) {
        return null;
    }
    const normalized = path.normalize(path.resolve(input));
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function findContextIdForRepo(
    contexts: Array<{ id?: string; paths?: string[] }>,
    repoRoot: string | null,
    explicitContextId?: string | null
): string | null {
    if (explicitContextId) {
        const explicit = contexts.find((context) => typeof context?.id === 'string' && context.id === explicitContextId);
        if (explicit?.id) {
            return explicit.id;
        }
    }

    if (!repoRoot) {
        return null;
    }

    const normalizedRoot = normalizeRepoIdentity(repoRoot);
    if (!normalizedRoot) {
        return null;
    }

    const matched = contexts.find((context) => (context.paths ?? []).some((rawPath) => {
        const normalizedPath = normalizeRepoIdentity(rawPath);
        if (!normalizedPath) {
            return false;
        }
        return normalizedRoot === normalizedPath || normalizedRoot.startsWith(`${normalizedPath}${path.sep}`);
    }));
    return matched?.id ?? null;
}

function getHookConfigPath(projectRoot: string, agent: GaHookAgent): string {
    switch (agent) {
        case 'claude':
            return path.join(projectRoot, '.claude', 'settings.local.json');
        case 'factory':
            return path.join(projectRoot, '.factory', 'settings.json');
        case 'antigravity':
            return path.join(projectRoot, '.gemini', 'settings.json');
    }
}

function isManagedCommandPresent(agent: GaHookAgent, configContent: string, expectedCommand: string | null): boolean {
    if (!expectedCommand) return false;
    if (!configContent.includes('0ctx hook ingest') && !configContent.includes('0ctx connector hook ingest')) return false;
    if (!configContent.includes(`--agent=${agent}`)) return false;
    const expectedPrefix = expectedCommand.replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ');
    return configContent.includes(expectedPrefix);
}

function isSessionStartPresent(agent: GaHookAgent, configContent: string): boolean {
    return configContent.includes('SessionStart')
        && (configContent.includes('0ctx hook session-start') || configContent.includes('0ctx connector hook session-start'))
        && configContent.includes(`--agent=${agent}`);
}

function readManagedProjectHookConfig(projectRoot: string): ManagedProjectHookConfig | null {
    const projectConfigPath = path.join(projectRoot, '.0ctx', 'settings.local.json');
    if (!fs.existsSync(projectConfigPath)) {
        return null;
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8')) as Record<string, unknown>;
        const hooks = Array.isArray(parsed.hooks) ? parsed.hooks : [];
        const agents = hooks
            .map((entry) => {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                    return null;
                }
                const record = entry as Record<string, unknown>;
                const agent = parseGaHookAgent(record.agent);
                if (!agent) {
                    return null;
                }
                return {
                    agent,
                    command: typeof record.command === 'string' ? record.command : null
                } satisfies ManagedHookEntry;
            })
            .filter((entry): entry is ManagedHookEntry => Boolean(entry));

        return {
            projectRoot: typeof parsed.projectRoot === 'string' ? parsed.projectRoot : null,
            contextId: typeof parsed.contextId === 'string' ? parsed.contextId : null,
            agents
        };
    } catch {
        return null;
    }
}

export function readRepoCaptureState(projectRoot: string): {
    captureManagedForRepo: boolean;
    captureReadyAgents: GaHookAgent[];
    sessionStartReadyAgents: GaHookAgent[];
} {
    const managed = readManagedProjectHookConfig(projectRoot);
    const normalizedRepoRoot = normalizeRepoIdentity(projectRoot);
    const normalizedManagedRoot = normalizeRepoIdentity(managed?.projectRoot ?? null);
    const captureManagedForRepo = Boolean(
        managed
        && managed.agents.length > 0
        && normalizedRepoRoot
        && normalizedManagedRoot
        && normalizedRepoRoot === normalizedManagedRoot
    );

    if (!captureManagedForRepo || !managed) {
        return {
            captureManagedForRepo: false,
            captureReadyAgents: [],
            sessionStartReadyAgents: []
        };
    }

    const captureReadyAgents: GaHookAgent[] = [];
    const sessionStartReadyAgents: GaHookAgent[] = [];

    for (const agentState of managed.agents) {
        const configPath = getHookConfigPath(projectRoot, agentState.agent);
        if (!fs.existsSync(configPath)) {
            continue;
        }
        let content = '';
        try {
            content = fs.readFileSync(configPath, 'utf8');
        } catch {
            continue;
        }
        if (isManagedCommandPresent(agentState.agent, content, agentState.command)) {
            captureReadyAgents.push(agentState.agent);
            if (isSessionStartPresent(agentState.agent, content)) {
                sessionStartReadyAgents.push(agentState.agent);
            }
        }
    }

    return {
        captureManagedForRepo: true,
        captureReadyAgents: [...new Set(captureReadyAgents)],
        sessionStartReadyAgents: [...new Set(sessionStartReadyAgents)]
    };
}
