import type { Graph, RepoReadinessSummary } from '@0ctx/core';
import { buildDataPolicySummary } from '../data-policy';
import { buildAgentContextPack } from '../workstream/agent-context';
import { resolveCurrentWorkstreamFromContextPaths } from '../workstream/lanes';
import { detectInstalledGaHookAgents, detectRegisteredGaMcpClients, resolveExpectedGaCaptureAgents } from './clients';
import { findContextIdForRepo, readRepoCaptureState } from './repo-config';

type GaHookAgent = 'claude' | 'factory' | 'antigravity';
type GaMcpClient = 'claude' | 'antigravity';

function requiresGaMcpRegistration(agent: GaHookAgent): agent is GaMcpClient {
    return agent === 'claude' || agent === 'antigravity';
}

function buildDataPolicyActionHint(summary: {
    syncPolicy: string;
    captureRetentionDays: number;
    debugRetentionDays: number;
    debugArtifactsEnabled: boolean;
    preset: string | null;
}): string | null {
    const preset = String(summary.preset || '').trim().toLowerCase();
    const syncPolicy = String(summary.syncPolicy || '').trim().toLowerCase();

    if (preset === 'custom') {
        return 'Normalize this workspace with Lean, Review, Debug, or explicit Full Sync only when needed.';
    }
    if (preset === 'shared' || syncPolicy === 'full_sync') {
        return 'Return this workspace to metadata_only when richer cloud sync is no longer needed.';
    }
    if (preset === 'debug' || summary.debugArtifactsEnabled) {
        return 'Turn off debug artifacts when troubleshooting is complete.';
    }
    if (preset === 'review' || summary.captureRetentionDays > 14 || summary.debugRetentionDays > 7) {
        return 'Return this machine to Lean when the longer local review window is no longer needed.';
    }
    return null;
}

function resolveGaAutoContextReadiness(options: {
    captureReadyAgents: GaHookAgent[];
    sessionStartReadyAgents: GaHookAgent[];
    registeredMcpClients: Array<'claude' | 'antigravity'>;
}): Pick<RepoReadinessSummary, 'autoContextAgents' | 'autoContextMissingAgents' | 'sessionStartMissingAgents' | 'mcpRegistrationMissingAgents'> {
    const captureReadyAgents = [...new Set(options.captureReadyAgents)];
    const sessionStartReadyAgents = [...new Set(options.sessionStartReadyAgents)];
    const registeredMcpClients = new Set(options.registeredMcpClients);

    const sessionStartMissingAgents = captureReadyAgents.filter((agent) => !sessionStartReadyAgents.includes(agent));
    const mcpRegistrationMissingAgents = sessionStartReadyAgents
        .filter(requiresGaMcpRegistration)
        .filter((agent) => !registeredMcpClients.has(agent));
    const autoContextAgents = sessionStartReadyAgents.filter(
        (agent) => !requiresGaMcpRegistration(agent) || registeredMcpClients.has(agent)
    );
    const autoContextMissingAgents = captureReadyAgents.filter((agent) => !autoContextAgents.includes(agent));

    return {
        autoContextAgents,
        autoContextMissingAgents,
        sessionStartMissingAgents,
        mcpRegistrationMissingAgents
    };
}

function buildAutoContextActionHint(options: {
    captureManagedForRepo: boolean;
    captureReadyAgents: GaHookAgent[];
    sessionStartMissingAgents: GaHookAgent[];
    mcpRegistrationMissingAgents: GaMcpClient[];
}): string | null {
    if (!options.captureManagedForRepo || options.captureReadyAgents.length === 0) {
        return 'Run 0ctx enable in this repo.';
    }

    const parts: string[] = [];
    if (options.sessionStartMissingAgents.length > 0) {
        parts.push(`Install automatic context injection for ${options.sessionStartMissingAgents.join(', ')}.`);
    }
    if (options.mcpRegistrationMissingAgents.length > 0) {
        parts.push(`Register MCP retrieval for ${options.mcpRegistrationMissingAgents.join(', ')}.`);
    }
    return parts.length > 0 ? parts.join(' ') : null;
}

export function buildRepoReadinessSummary(
    graph: Graph,
    options: {
        repoRoot?: string | null;
        contextId?: string | null;
    } = {}
): RepoReadinessSummary {
    const repoRoot = typeof options.repoRoot === 'string' && options.repoRoot.trim().length > 0
        ? options.repoRoot
        : null;
    const contexts = graph.listContexts();
    const contextId = findContextIdForRepo(contexts, repoRoot, options.contextId ?? null);
    const context = contextId ? graph.getContext(contextId) : null;

    const inferredCurrent = repoRoot
        ? resolveCurrentWorkstreamFromContextPaths([repoRoot])
        : resolveCurrentWorkstreamFromContextPaths(Array.isArray(context?.paths) ? context.paths : []);

    if (!context || !contextId) {
        const policy = buildDataPolicySummary(graph, null);
        return {
            repoRoot: repoRoot ?? '',
            contextId: null,
            workspaceName: null,
            workstream: inferredCurrent.branch,
            sessionCount: null,
            checkpointCount: null,
            syncPolicy: null,
            syncScope: policy.syncScope,
            captureScope: policy.captureScope,
            debugScope: policy.debugScope,
            captureReadyAgents: [],
            autoContextAgents: [],
            autoContextMissingAgents: [],
            sessionStartMissingAgents: [],
            mcpRegistrationMissingAgents: [],
            captureMissingAgents: resolveExpectedGaCaptureAgents([]),
            captureManagedForRepo: false,
            zeroTouchReady: false,
            nextActionHint: 'Run 0ctx enable in this repo.',
            dataPolicyPreset: policy.preset,
            dataPolicyActionHint: buildDataPolicyActionHint(policy),
            captureRetentionDays: policy.captureRetentionDays,
            debugRetentionDays: policy.debugRetentionDays,
            debugArtifactsEnabled: policy.debugArtifactsEnabled
        };
    }

    const pack = buildAgentContextPack(graph, contextId, {
        branch: inferredCurrent.branch,
        worktreePath: inferredCurrent.worktreePath,
        sessionLimit: 3,
        checkpointLimit: 2,
        handoffLimit: 3
    });
    const policy = buildDataPolicySummary(graph, contextId);
    const repoCapture = repoRoot
        ? readRepoCaptureState(repoRoot)
        : { captureManagedForRepo: false, captureReadyAgents: [], sessionStartReadyAgents: [] };
    const autoContext = resolveGaAutoContextReadiness({
        captureReadyAgents: repoCapture.captureReadyAgents,
        sessionStartReadyAgents: repoCapture.sessionStartReadyAgents,
        registeredMcpClients: detectRegisteredGaMcpClients()
    });
    const captureMissingAgents = resolveExpectedGaCaptureAgents(repoCapture.captureReadyAgents)
        .filter((agent) => !repoCapture.captureReadyAgents.includes(agent));
    const zeroTouchReady = repoCapture.captureManagedForRepo
        && autoContext.autoContextMissingAgents.length === 0
        && repoCapture.captureReadyAgents.length > 0;

    return {
        repoRoot: repoRoot ?? (Array.isArray(context.paths) ? context.paths.find((entry) => typeof entry === 'string' && entry.trim().length > 0) ?? '' : ''),
        contextId,
        workspaceName: pack.workspaceName,
        workstream: pack.branch,
        sessionCount: pack.workstream.sessionCount,
        checkpointCount: pack.workstream.checkpointCount,
        syncPolicy: policy.syncPolicy,
        syncScope: policy.syncScope,
        captureScope: policy.captureScope,
        debugScope: policy.debugScope,
        captureReadyAgents: repoCapture.captureReadyAgents,
        autoContextAgents: autoContext.autoContextAgents,
        autoContextMissingAgents: autoContext.autoContextMissingAgents,
        sessionStartMissingAgents: autoContext.sessionStartMissingAgents,
        mcpRegistrationMissingAgents: autoContext.mcpRegistrationMissingAgents,
        captureMissingAgents,
        captureManagedForRepo: repoCapture.captureManagedForRepo,
        zeroTouchReady,
        nextActionHint: buildAutoContextActionHint({
            captureManagedForRepo: repoCapture.captureManagedForRepo,
            captureReadyAgents: repoCapture.captureReadyAgents,
            sessionStartMissingAgents: autoContext.sessionStartMissingAgents as GaHookAgent[],
            mcpRegistrationMissingAgents: autoContext.mcpRegistrationMissingAgents as GaMcpClient[]
        }) ?? buildDataPolicyActionHint(policy),
        dataPolicyPreset: policy.preset,
        dataPolicyActionHint: buildDataPolicyActionHint(policy),
        captureRetentionDays: policy.captureRetentionDays,
        debugRetentionDays: policy.debugRetentionDays,
        debugArtifactsEnabled: policy.debugArtifactsEnabled
    };
}
