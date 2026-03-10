import type { HookSupportedAgent } from '../hooks';
import type { DoctorCheck, HookHealthDetails, HookInstallClient, RepoReadinessSummary, SupportedClient } from './types';
import { resolveExpectedGaCaptureAgents } from './readiness-agents';
import { buildGaAutoContextActionHint, resolveGaAutoContextReadiness } from './readiness-retrieval';
import {
    buildDataPolicyActionHint,
    normalizeRepoIdentity,
    resolveRepoScopedHookDetails
} from './readiness-hooks';

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
    detectInstalledGaHookClients: () => HookInstallClient[];
    detectRegisteredGaMcpClients: () => SupportedClient[];
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
        const detectedHookClients = deps.detectInstalledGaHookClients();
        const registeredMcpClients = deps.detectRegisteredGaMcpClients();
        const contexts = await deps.sendToDaemon<Array<{ id?: string; name?: string; paths?: string[] }> | null>('listContexts', {});
        if (!Array.isArray(contexts)) {
            return null;
        }

        const matchedContextId = options.contextId ?? deps.selectHookContextId(contexts, repoRoot, null);
        const matchedContext = typeof matchedContextId === 'string' ? contexts.find(context => context?.id === matchedContextId) ?? null : null;

        if (!matchedContextId || !matchedContext) {
            const policy = await deps.sendToDaemon<{
                preset?: string | null;
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
                syncScope: 'workspace',
                captureScope: 'machine',
                debugScope: 'machine',
                captureReadyAgents: [],
                autoContextAgents: [],
                autoContextMissingAgents: [],
                sessionStartMissingAgents: [],
                mcpRegistrationMissingAgents: [],
                captureMissingAgents: resolveExpectedGaCaptureAgents({
                    defaultHookInstallClients: deps.defaultHookInstallClients,
                    detectedHookClients,
                    captureReadyAgents: []
                }),
                captureManagedForRepo: false,
                zeroTouchReady: false,
                nextActionHint: 'Run 0ctx enable in this repo.',
                dataPolicyPreset: typeof policy?.preset === 'string' ? policy.preset : null,
                dataPolicyActionHint: buildDataPolicyActionHint(policy),
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
            preset?: string | null;
            syncPolicy?: string | null;
            captureRetentionDays?: number;
            debugRetentionDays?: number;
            debugArtifactsEnabled?: boolean;
        } | null>('getDataPolicy', { contextId: matchedContextId });
        const syncPolicy = typeof dataPolicy?.syncPolicy === 'string' ? dataPolicy.syncPolicy : null;

        const hookDetails = resolveRepoScopedHookDetails({
            repoRoot,
            fallback: options.hookDetails ?? (await deps.collectHookHealth()).details
        });
        const hookProjectRoot = normalizeRepoIdentity(hookDetails.projectRoot);
        const normalizedRepoRoot = normalizeRepoIdentity(repoRoot);
        const captureManagedForRepo = hookProjectRoot !== null && normalizedRepoRoot !== null && hookProjectRoot === normalizedRepoRoot;
        const configuredAgents = captureManagedForRepo
            ? hookDetails.agents
                .filter(agent => agent.configExists && agent.commandPresent)
                .map(agent => agent.agent)
                .filter((agent): agent is HookSupportedAgent => Boolean(agent))
            : [];
        const captureReadyAgents = configuredAgents.filter(deps.isGaHookAgent);
        const sessionStartReadyAgents = captureManagedForRepo
            ? hookDetails.agents
                .filter(agent =>
                    deps.isGaHookAgent(agent.agent)
                    && agent.configExists
                    && agent.commandPresent
                    && agent.sessionStartPresent
                    && deps.sessionStartAgents.includes(agent.agent)
                )
                .map(agent => agent.agent)
            : [];
        const autoContextReadiness = resolveGaAutoContextReadiness({
            captureReadyAgents,
            sessionStartReadyAgents,
            registeredMcpClients
        });
        const expectedCaptureAgents = resolveExpectedGaCaptureAgents({
            defaultHookInstallClients: deps.defaultHookInstallClients,
            detectedHookClients,
            captureReadyAgents
        });
        const captureMissingAgents = expectedCaptureAgents.filter(
            agent => !captureReadyAgents.includes(agent as Extract<HookSupportedAgent, 'claude' | 'factory' | 'antigravity'>)
        );
        const zeroTouchReady = captureManagedForRepo && autoContextReadiness.autoContextAgents.length > 0;
        const nextActionHint = (!captureManagedForRepo || captureReadyAgents.length === 0)
            ? 'Run 0ctx enable to install supported capture integrations.'
            : buildGaAutoContextActionHint({
                sessionStartMissingAgents: autoContextReadiness.sessionStartMissingAgents,
                mcpRegistrationMissingAgents: autoContextReadiness.mcpRegistrationMissingAgents
            });

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
            syncScope: 'workspace',
            captureScope: 'machine',
            debugScope: 'machine',
            captureReadyAgents,
            autoContextAgents: autoContextReadiness.autoContextAgents,
            autoContextMissingAgents: autoContextReadiness.autoContextMissingAgents,
            sessionStartMissingAgents: autoContextReadiness.sessionStartMissingAgents,
            mcpRegistrationMissingAgents: autoContextReadiness.mcpRegistrationMissingAgents,
            captureMissingAgents,
            captureManagedForRepo,
            zeroTouchReady,
            nextActionHint,
            dataPolicyPreset: typeof dataPolicy?.preset === 'string' ? dataPolicy.preset : null,
            dataPolicyActionHint: buildDataPolicyActionHint({
                ...dataPolicy,
                syncPolicy,
                captureRetentionDays: typeof dataPolicy?.captureRetentionDays === 'number' ? dataPolicy.captureRetentionDays : 14,
                debugRetentionDays: typeof dataPolicy?.debugRetentionDays === 'number' ? dataPolicy.debugRetentionDays : 7,
                debugArtifactsEnabled: dataPolicy?.debugArtifactsEnabled === true,
                preset: (dataPolicy as { preset?: string | null } | null | undefined)?.preset ?? null
            }),
            captureRetentionDays: typeof dataPolicy?.captureRetentionDays === 'number' ? dataPolicy.captureRetentionDays : 14,
            debugRetentionDays: typeof dataPolicy?.debugRetentionDays === 'number' ? dataPolicy.debugRetentionDays : 7,
            debugArtifactsEnabled: dataPolicy?.debugArtifactsEnabled === true
        };
    };
}
