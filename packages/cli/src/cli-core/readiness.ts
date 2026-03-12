import fs from 'fs';
import path from 'path';
import { isGaHookAgent } from './clients';
import type { HookSupportedAgent } from '../hooks';
import type { DoctorCheck, HookHealthDetails, HookHealthAgentCheck } from './types';
import {
    isHookCommandPresent,
    isSessionStartCommandPresent
} from './readiness-hooks';
export { createRepoReadinessCollector } from './repo-readiness';

export function createHookHealthCollector(deps: {
    getHookDumpDir: () => string;
    getHookDumpRetentionDays: () => number;
    getHookDebugRetentionDays: () => number;
    isHookDebugArtifactsEnabled: () => boolean;
    getHookStatePath: () => string;
    getHookConfigPath: (projectRoot: string, agent: HookSupportedAgent) => string;
    readHookInstallState: () => {
        projectRoot?: string | null;
        projectConfigPath?: string | null;
        contextId?: string | null;
        agents: Array<{ agent: HookSupportedAgent; installed: boolean; command?: string | null }>;
    };
    sendToDaemon: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
}) {
    return async function collectHookHealth(): Promise<{
        check: DoctorCheck;
        dumpCheck: DoctorCheck;
        details: HookHealthDetails;
    }> {
        const state = deps.readHookInstallState();
        const statePath = deps.getHookStatePath();
        const projectRoot = state.projectRoot ? path.resolve(state.projectRoot) : null;
        const projectConfigPath = state.projectConfigPath ?? (projectRoot ? path.join(projectRoot, '.0ctx', 'settings.local.json') : null);
        const installedAgents = state.agents.filter(agent => agent.installed);
        const installedGaAgents = installedAgents.filter(agent => isGaHookAgent(agent.agent));
        const installedPreviewAgents = installedAgents.filter(agent => !isGaHookAgent(agent.agent));
        const projectRootExists = projectRoot ? fs.existsSync(projectRoot) : false;
        const projectConfigExists = projectConfigPath ? fs.existsSync(projectConfigPath) : false;
        let contextIdExists: boolean | null = null;

        if (state.contextId) {
            try {
                const contexts = await deps.sendToDaemon('listContexts', {}) as Array<{ id?: string }> | null;
                contextIdExists = Array.isArray(contexts)
                    ? contexts.some(context => context?.id === state.contextId)
                    : false;
            } catch {
                contextIdExists = null;
            }
        }

        const allAgents: HookHealthAgentCheck[] = installedAgents.map(agentState => {
            const configPath = projectRoot ? deps.getHookConfigPath(projectRoot, agentState.agent) : deps.getHookConfigPath('.', agentState.agent);
            const configExists = fs.existsSync(configPath);
            const content = configExists ? fs.readFileSync(configPath, 'utf8') : '';
            return {
                agent: agentState.agent,
                configPath,
                configExists,
                commandPresent: configExists && isHookCommandPresent(agentState.agent, content, agentState.command ?? null),
                sessionStartPresent: configExists && isSessionStartCommandPresent(agentState.agent, content),
                command: agentState.command ?? null
            };
        });
        const agents = allAgents.filter(agent => isGaHookAgent(agent.agent));
        const previewAgents = allAgents.filter(agent => !isGaHookAgent(agent.agent));

        const missingAgents = agents.filter(agent => !agent.configExists || !agent.commandPresent);
        const dumpDir = deps.getHookDumpDir();
        let dumpDirWritable = true;
        let dumpDirError: string | null = null;
        try {
            fs.mkdirSync(dumpDir, { recursive: true });
            fs.accessSync(dumpDir, fs.constants.W_OK);
        } catch (error) {
            dumpDirWritable = false;
            dumpDirError = error instanceof Error ? error.message : String(error);
        }

        let status: 'pass' | 'warn' | 'fail' = 'pass';
        let message = 'Managed capture integration state is healthy.';

        if (!projectRoot) {
            status = 'warn';
            message = 'No managed capture integration project has been recorded yet.';
        } else if (!projectRootExists) {
            status = 'fail';
            message = 'Managed capture integration project root no longer exists.';
        } else if (!projectConfigExists) {
            status = 'fail';
            message = 'Managed capture integration project config is missing.';
        } else if (missingAgents.length > 0) {
            status = 'fail';
            message = 'One or more managed capture integration configs are missing or stale.';
        } else if (state.contextId && contextIdExists === false) {
            status = 'warn';
            message = 'Stored capture state references a missing workspace; rerun 0ctx enable in this repo.';
        }

        const details: HookHealthDetails = {
            statePath,
            projectRoot,
            projectRootExists,
            projectConfigPath,
            projectConfigExists,
            contextId: state.contextId ?? null,
            contextIdExists,
            installedAgentCount: installedGaAgents.length,
            agents,
            previewInstalledAgentCount: installedPreviewAgents.length,
            previewAgents
        };

        return {
            check: {
                id: 'hook_state',
                status,
                message,
                details: { ...details }
            },
            dumpCheck: {
                id: 'hook_dump_dir',
                status: dumpDirWritable ? 'pass' : 'warn',
                message: dumpDirWritable
                    ? deps.isHookDebugArtifactsEnabled()
                        ? `Debug artifact directory is writable (debug artifacts enabled; raw dumps kept ${deps.getHookDumpRetentionDays()} days, debug trails kept ${deps.getHookDebugRetentionDays()} days).`
                        : `Debug artifact directory is writable (raw dumps and debug trails are off by default; kept locally for ${deps.getHookDebugRetentionDays()} days only when debug artifacts are enabled).`
                    : 'Hook dump directory is not writable.',
                details: {
                    path: dumpDir,
                    retentionDays: deps.getHookDumpRetentionDays(),
                    debugRetentionDays: deps.getHookDebugRetentionDays(),
                    error: dumpDirError
                }
            },
            details
        };
    };
}
