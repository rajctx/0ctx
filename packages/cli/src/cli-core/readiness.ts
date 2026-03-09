import fs from 'fs';
import path from 'path';
import type { HookSupportedAgent } from '../hooks';
import type {
    DoctorCheck,
    HookHealthDetails,
    HookInstallClient,
    HookHealthAgentCheck,
    RepoReadinessSummary
} from './types';

function isHookCommandPresent(agent: HookSupportedAgent, configContent: string, expectedCommand: string | null): boolean {
    if (agent === 'codex') {
        return configContent.includes('# BEGIN 0ctx-codex-notify')
            && configContent.includes('# END 0ctx-codex-notify')
            && configContent.includes('--agent=codex');
    }

    if (!expectedCommand) return false;
    return configContent.includes('0ctx connector hook ingest')
        && configContent.includes(`--agent=${agent}`)
        && configContent.includes(expectedCommand.replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' '));
}

export function createHookHealthCollector(deps: {
    getHookDumpDir: () => string;
    getHookDumpRetentionDays: () => number;
    getHookDebugRetentionDays: () => number;
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

        const agents: HookHealthAgentCheck[] = installedAgents.map(agentState => {
            const configPath = projectRoot ? deps.getHookConfigPath(projectRoot, agentState.agent) : deps.getHookConfigPath('.', agentState.agent);
            const configExists = fs.existsSync(configPath);
            const content = configExists ? fs.readFileSync(configPath, 'utf8') : '';
            return {
                agent: agentState.agent,
                configPath,
                configExists,
                commandPresent: configExists && isHookCommandPresent(agentState.agent, content, agentState.command ?? null),
                command: agentState.command ?? null
            };
        });

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
            installedAgentCount: installedAgents.length,
            agents
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
                    ? `Hook dump directory is writable (dump retention ${deps.getHookDumpRetentionDays()} days, debug retention ${deps.getHookDebugRetentionDays()} days).`
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

export function createRepoReadinessCollector(deps: {
    ensureDaemonCapabilities: (methods: string[]) => Promise<{ ok: boolean; missingMethods: string[]; error?: string | null }>;
    resolveRepoRoot: (repoRoot?: string | null | undefined) => string;
    selectHookContextId: (
        contexts: Array<{ id?: string; paths?: string[] }>,
        repoRoot: string | null,
        explicitContextId?: string | null | undefined
    ) => string | null;
    sendToDaemon: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
    getCurrentWorkstream: (repoRoot: string) => string | null;
    collectHookHealth: () => Promise<{
        check: DoctorCheck;
        dumpCheck: DoctorCheck;
        details: HookHealthDetails;
    }>;
    defaultHookInstallClients: HookInstallClient[];
    sessionStartAgents: Array<Extract<HookSupportedAgent, 'claude' | 'factory' | 'antigravity'>>;
    isGaHookAgent: (agent: HookSupportedAgent) => agent is Extract<HookSupportedAgent, 'claude' | 'factory' | 'antigravity'>;
}) {
    return async function collectRepoReadiness(options: {
        repoRoot?: string | null;
        contextId?: string | null;
        hookDetails?: HookHealthDetails | null;
    } = {}): Promise<RepoReadinessSummary | null> {
        const capabilityCheck = await deps.ensureDaemonCapabilities(['getDataPolicy', 'getAgentContextPack']);
        if (!capabilityCheck.ok) {
            throw new Error(`daemon capabilities stale: ${capabilityCheck.missingMethods.join(', ') || capabilityCheck.error || 'unknown'}`);
        }

        const repoRoot = deps.resolveRepoRoot(options.repoRoot ?? null);
        const contexts = await deps.sendToDaemon<Array<{ id?: string; name?: string; paths?: string[] }> | null>('listContexts', {});
        if (!Array.isArray(contexts)) {
            return null;
        }

        const matchedContextId = options.contextId ?? deps.selectHookContextId(contexts, repoRoot, null);
        const matchedContext = typeof matchedContextId === 'string'
            ? contexts.find(context => context?.id === matchedContextId) ?? null
            : null;

        if (!matchedContextId || !matchedContext) {
            const policy = await deps.sendToDaemon<{
                captureRetentionDays?: number;
                debugRetentionDays?: number;
                debugArtifactsEnabled?: boolean;
            } | null>('getDataPolicy', {});
            return {
                repoRoot,
                contextId: null,
                workspaceName: null,
                workstream: deps.getCurrentWorkstream(repoRoot),
                sessionCount: null,
                checkpointCount: null,
                syncPolicy: null,
                captureReadyAgents: [],
                autoContextAgents: [],
                captureMissingAgents: [...deps.defaultHookInstallClients],
                captureManagedForRepo: false,
                zeroTouchReady: false,
                nextActionHint: 'Run 0ctx enable in this repo.',
                captureRetentionDays: typeof policy?.captureRetentionDays === 'number' ? policy.captureRetentionDays : 14,
                debugRetentionDays: typeof policy?.debugRetentionDays === 'number' ? policy.debugRetentionDays : 7,
                debugArtifactsEnabled: policy?.debugArtifactsEnabled === true
            };
        }

        const branch = deps.getCurrentWorkstream(repoRoot);
        const pack = await deps.sendToDaemon<{
            workspaceName?: string;
            branch?: string | null;
            workstream?: { sessionCount?: number; checkpointCount?: number };
        } | null>('getAgentContextPack', {
            contextId: matchedContextId,
            branch,
            sessionLimit: 3,
            checkpointLimit: 2,
            handoffLimit: 3
        });
        const dataPolicy = await deps.sendToDaemon<{
            syncPolicy?: string | null;
            captureRetentionDays?: number;
            debugRetentionDays?: number;
            debugArtifactsEnabled?: boolean;
        } | null>('getDataPolicy', { contextId: matchedContextId });
        const syncPolicy = typeof dataPolicy?.syncPolicy === 'string' ? dataPolicy.syncPolicy : null;

        const hookDetails = options.hookDetails ?? (await deps.collectHookHealth()).details;
        const hookProjectRoot = hookDetails.projectRoot ? path.resolve(hookDetails.projectRoot) : null;
        const captureManagedForRepo = hookProjectRoot === repoRoot;
        const configuredAgents = captureManagedForRepo
            ? hookDetails.agents
                .filter(agent => agent.configExists && agent.commandPresent)
                .map(agent => agent.agent)
                .filter((agent): agent is HookSupportedAgent => Boolean(agent))
            : [];
        const captureReadyAgents = configuredAgents.filter(deps.isGaHookAgent);
        const autoContextAgents = captureReadyAgents.filter(agent => deps.sessionStartAgents.includes(agent));
        const captureMissingAgents = deps.defaultHookInstallClients.filter(
            agent => !captureReadyAgents.includes(agent as Extract<HookSupportedAgent, 'claude' | 'factory' | 'antigravity'>)
        );
        const zeroTouchReady = captureManagedForRepo && autoContextAgents.length > 0;
        let nextActionHint: string | null = null;

        if (!captureManagedForRepo || captureReadyAgents.length === 0) {
            nextActionHint = 'Run 0ctx enable to install supported capture integrations.';
        } else if (autoContextAgents.length === 0) {
            nextActionHint = 'Install a GA integration with automatic context injection (claude, factory, or antigravity).';
        }

        return {
            repoRoot,
            contextId: matchedContextId,
            workspaceName: typeof pack?.workspaceName === 'string'
                ? pack.workspaceName
                : (typeof matchedContext.name === 'string' ? matchedContext.name : null),
            workstream: typeof pack?.branch === 'string' && pack.branch.trim().length > 0
                ? pack.branch
                : branch,
            sessionCount: typeof pack?.workstream?.sessionCount === 'number' ? pack.workstream.sessionCount : null,
            checkpointCount: typeof pack?.workstream?.checkpointCount === 'number' ? pack.workstream.checkpointCount : null,
            syncPolicy,
            captureReadyAgents,
            autoContextAgents,
            captureMissingAgents,
            captureManagedForRepo,
            zeroTouchReady,
            nextActionHint,
            captureRetentionDays: typeof dataPolicy?.captureRetentionDays === 'number' ? dataPolicy.captureRetentionDays : 14,
            debugRetentionDays: typeof dataPolicy?.debugRetentionDays === 'number' ? dataPolicy.debugRetentionDays : 7,
            debugArtifactsEnabled: dataPolicy?.debugArtifactsEnabled === true
        };
    };
}
