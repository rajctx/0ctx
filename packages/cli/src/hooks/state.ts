import fs from 'fs';
import { getHookStatePath } from './config';
import { defaultHookAgents } from './shared';
import { type HookAgentState, type HookInstallState } from './types';

function buildHookProjectConfig(state: HookInstallState): Record<string, unknown> {
    const hooks = state.agents
        .filter((agent) => agent.installed)
        .map((agent) => ({
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
            const matched = parsedAgents.find((agent) => agent?.agent === base.agent);
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

export { buildHookProjectConfig };
