import {
    type Graph,
    type AuditAction,
    type AuditMetadata,
    type AuditEntry,
    type SearchResult,
    type BranchLaneSummary,
    type AgentSessionSummary,
    type CheckpointSummary,
    type WorkstreamBrief,
    type WorkstreamBaselineComparison,
    type WorkstreamComparison,
    type AgentContextPack,
    type InsightSummary,
    type DataPolicySummary
} from '@0ctx/core';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { DaemonRequest } from './protocol';
import {
    clearConnectionContext,
    clearSessionContext,
    createSession,
    getConnectionContext,
    setConnectionContext,
    setSessionContext,
    touchSession
} from './resolver';
import { listBackups, readContextBackup, writeContextBackup } from './backup';
import { readAuthState } from './auth';
import type { MetricsSnapshot } from './metrics';
import type { SyncEngine } from './sync-engine';
import type { EventRuntime } from './events';
import {
    buildAgentContextPack,
    buildWorkstreamBrief,
    compareWorkstreams,
    enrichWorkstreamLane
} from './workstream';
import { compareWorkspaces } from './workspace/compare';
import {
    applyDataPolicyUpdate,
    buildDataPolicySummary,
    getHookDebugRetentionDays,
    getHookDumpRetentionDays,
    isHookDebugArtifactsEnabled
} from './data-policy';

const CONTEXT_REQUIRED_METHODS = new Set([
    'addNode',
    'getByKey',
    'search',
    'getGraphData',
    'listChatSessions',
    'listChatTurns',
    'listBranchLanes',
    'listWorkstreamInsights',
    'getWorkstreamBrief',
    'getAgentContextPack',
    'compareWorkstreams',
    'listBranchSessions',
    'listSessionMessages',
    'listBranchCheckpoints',
    'getSessionDetail',
    'getCheckpointDetail',
    'getHandoffTimeline',
    'previewSessionKnowledge',
    'extractSessionKnowledge',
    'promoteInsight',
    'saveCheckpoint',
    'createSessionCheckpoint',
    'listCheckpoints',
    'resumeSession',
    'rewindCheckpoint',
    'explainCheckpoint',
    'createBackup',
    'getSyncPolicy',
    'setSyncPolicy'
]);

type RequestParams = Record<string, unknown>;

export interface HandlerRuntimeContext {
    startedAt: number;
    getMetricsSnapshot?: () => MetricsSnapshot;
    syncEngine?: SyncEngine;
    eventRuntime?: EventRuntime;
    requestShutdown?: () => void;
}

const MUTATING_ACTIONS: Record<string, AuditAction> = {
    createContext: 'create_context',
    deleteContext: 'delete_context',
    switchContext: 'switch_context',
    addNode: 'add_node',
    updateNode: 'update_node',
    deleteNode: 'delete_node',
    addEdge: 'add_edge',
    saveCheckpoint: 'save_checkpoint',
    createSessionCheckpoint: 'save_checkpoint',
    rewind: 'rewind',
    rewindCheckpoint: 'rewind',
    createBackup: 'create_backup',
    restoreBackup: 'restore_backup',
    promoteInsight: 'promote_insight',
    setDataPolicy: 'set_data_policy'
};

function getParams(req: DaemonRequest): RequestParams {
    return (req.params ?? {}) as RequestParams;
}

function getContextIdFromParams(params: RequestParams): string | null {
    return typeof params.contextId === 'string' && params.contextId.length > 0 ? params.contextId : null;
}

function assertValidSession(req: DaemonRequest, sessionExists: boolean): void {
    if (req.method === 'createSession') return;
    if (req.sessionToken && !sessionExists) {
        throw new Error(`Invalid sessionToken '${req.sessionToken}'`);
    }
}

function resolveContextId(connectionId: string, params: RequestParams, sessionContextId: string | null): string | null {
    return getContextIdFromParams(params) || sessionContextId || getConnectionContext(connectionId);
}

function syncActiveContext(connectionId: string, sessionToken: string | undefined, contextId: string): void {
    setConnectionContext(connectionId, contextId);
    if (sessionToken) {
        setSessionContext(sessionToken, contextId);
    }
}

function toAuditMetadata(connectionId: string, req: DaemonRequest, params: RequestParams): AuditMetadata {
    return {
        actor: typeof params.actor === 'string' ? params.actor : null,
        source: typeof params.source === 'string' ? params.source : null,
        sessionToken: req.sessionToken ?? null,
        connectionId,
        requestId: req.requestId ?? null,
        method: req.method
    };
}

function recordMutationAudit(
    graph: Graph,
    req: DaemonRequest,
    action: AuditAction,
    contextId: string | null,
    params: RequestParams,
    result: unknown,
    metadata: AuditMetadata
): void {
    const payload = { ...params };
    delete payload.content;
    delete payload.rawPayload;

    graph.recordAuditEvent({
        action,
        contextId,
        payload: {
            method: req.method,
            params: payload
        },
        result: result && typeof result === 'object'
            ? (result as Record<string, unknown>)
            : { value: result ?? null },
        metadata
    });
}

function toEventSource(connectionId: string, req: DaemonRequest): string {
    return req.sessionToken ? `session:${req.sessionToken}` : `connection:${connectionId}`;
}

function toEventPayload(params: RequestParams, result: unknown): Record<string, unknown> {
    const sanitizedParams = { ...params };
    delete sanitizedParams.content;
    delete sanitizedParams.rawPayload;
    return {
        params: sanitizedParams,
        result: result && typeof result === 'object'
            ? (result as Record<string, unknown>)
            : { value: result ?? null }
    };
}

function parseSyncPolicy(value: unknown): 'local_only' | 'metadata_only' | 'full_sync' | null {
    if (value === 'local_only' || value === 'metadata_only' || value === 'full_sync') {
        return value;
    }
    return null;
}

function parsePositiveInt(value: unknown, fallback: number, max = 500): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(1, Math.min(max, Math.floor(value)));
}

function parsePositiveHours(value: unknown, fallbackHours: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallbackHours;
    return value;
}

function parseStringArray(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
        const entries = value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
        return entries.length > 0 ? entries : [];
    }
    if (typeof value === 'string') {
        const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
        return entries.length > 0 ? entries : [];
    }
    return undefined;
}

function parseDepth(value: unknown, fallback = 2): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(1, Math.min(5, Math.floor(value)));
}

interface RecallFeedbackSignal {
    nodeId: string;
    helpful: boolean;
    reason: string | null;
    createdAt: number;
    contextId: string | null;
    actor: string | null;
    source: string | null;
}

function parseRecallFeedbackSignal(entry: AuditEntry): RecallFeedbackSignal | null {
    if (entry.action !== 'recall_feedback') return null;
    if (!entry.payload || typeof entry.payload !== 'object') return null;

    const payload = entry.payload as Record<string, unknown>;
    const payloadParams = payload.params && typeof payload.params === 'object'
        ? payload.params as Record<string, unknown>
        : payload;
    const nodeId = typeof payloadParams.nodeId === 'string' ? payloadParams.nodeId.trim() : '';
    if (!nodeId) return null;
    const helpful = typeof payloadParams.helpful === 'boolean' ? payloadParams.helpful : null;
    if (helpful === null) return null;
    const reason = typeof payloadParams.reason === 'string' && payloadParams.reason.trim().length > 0
        ? payloadParams.reason.trim()
        : null;

    return {
        nodeId,
        helpful,
        reason,
        createdAt: entry.createdAt,
        contextId: entry.contextId ?? null,
        actor: entry.actor ?? null,
        source: entry.source ?? null
    };
}

function collectRecallFeedbackSignals(
    graph: Graph,
    contextId: string,
    limit = 500
): Map<string, { helpful: number; notHelpful: number; netAdjustment: number; lastFeedbackAt: number }> {
    const events = graph.listAuditEvents(contextId, limit);
    const map = new Map<string, { helpful: number; notHelpful: number; netAdjustment: number; lastFeedbackAt: number }>();

    for (const event of events) {
        const parsed = parseRecallFeedbackSignal(event);
        if (!parsed) continue;

        const existing = map.get(parsed.nodeId) ?? {
            helpful: 0,
            notHelpful: 0,
            netAdjustment: 0,
            lastFeedbackAt: 0
        };
        if (parsed.helpful) {
            existing.helpful += 1;
        } else {
            existing.notHelpful += 1;
        }
        existing.lastFeedbackAt = Math.max(existing.lastFeedbackAt, parsed.createdAt);

        // Stronger penalty for negative feedback to avoid repeating bad recalls.
        const rawNet = (existing.helpful * 6) - (existing.notHelpful * 9);
        existing.netAdjustment = Math.max(-30, Math.min(24, rawNet));
        map.set(parsed.nodeId, existing);
    }

    return map;
}

function extractAuditTargetId(entry: { payload?: Record<string, unknown>; result?: Record<string, unknown> | null }): string | null {
    const payload = (entry.payload && typeof entry.payload === 'object') ? entry.payload : {};
    const result = (entry.result && typeof entry.result === 'object') ? entry.result : {};
    const payloadId = typeof payload.id === 'string' ? payload.id : (typeof payload.nodeId === 'string' ? payload.nodeId : null);
    if (payloadId) return payloadId;
    const resultId = typeof result.id === 'string' ? result.id : (typeof result.nodeId === 'string' ? result.nodeId : null);
    return resultId;
}

function isHiddenAuditEvent(entry: AuditEntry): boolean {
    const payload = (entry.payload && typeof entry.payload === 'object') ? entry.payload as Record<string, unknown> : {};
    const payloadParams = payload.params && typeof payload.params === 'object'
        ? payload.params as Record<string, unknown>
        : payload;
    const result = (entry.result && typeof entry.result === 'object') ? entry.result as Record<string, unknown> : {};
    return payloadParams.hidden === true || result.hidden === true;
}

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

function readHookHealth(): {
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
    if (!fs.existsSync(statePath)) {
        return {
            statePath,
            projectRoot: null,
            contextId: null,
            projectConfigPath: null,
            updatedAt: null,
            capturePolicy: {
                captureRetentionDays: getHookDumpRetentionDays(),
                debugRetentionDays: getHookDebugRetentionDays(),
                debugArtifactsEnabled: isHookDebugArtifactsEnabled()
            },
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
            capturePolicy: {
                captureRetentionDays: getHookDumpRetentionDays(),
                debugRetentionDays: getHookDebugRetentionDays(),
                debugArtifactsEnabled: isHookDebugArtifactsEnabled()
            },
            agents
        };
    } catch {
        return {
            statePath,
            projectRoot: null,
            contextId: null,
            projectConfigPath: null,
            updatedAt: null,
            capturePolicy: {
                captureRetentionDays: getHookDumpRetentionDays(),
                debugRetentionDays: getHookDebugRetentionDays(),
                debugArtifactsEnabled: isHookDebugArtifactsEnabled()
            },
            agents: defaults
        };
    }
}

function buildTemporalRecall(
    graph: Graph,
    contextId: string | null,
    sinceHours: number,
    limit: number
): {
    mode: 'temporal';
    contextId: string | null;
    sinceHours: number;
    totalEvents: number;
    sessions: Array<{
        sessionId: string;
        startAt: number;
        endAt: number;
        eventCount: number;
        actions: string[];
        targetIds: string[];
        recentEvents: Array<{ action: string; createdAt: number; targetId: string | null }>;
    }>;
} {
    const sinceMs = sinceHours * 60 * 60 * 1000;
    const minCreatedAt = Date.now() - sinceMs;
    const windowed = graph
        .listAuditEvents(contextId ?? undefined, Math.max(limit * 10, 100))
        .filter(event => event.createdAt >= minCreatedAt)
        .filter(event => !isHiddenAuditEvent(event))
        .slice(0, Math.max(limit * 5, limit));

    const sessions = new Map<string, Array<{
        action: string;
        createdAt: number;
        targetId: string | null;
    }>>();

    for (const event of windowed) {
        const sessionId = event.sessionToken ?? event.connectionId ?? 'unknown';
        const list = sessions.get(sessionId) ?? [];
        list.push({
            action: event.action,
            createdAt: event.createdAt,
            targetId: extractAuditTargetId(event)
        });
        sessions.set(sessionId, list);
    }

    const grouped = Array.from(sessions.entries())
        .map(([sessionId, events]) => {
            const sorted = [...events].sort((a, b) => b.createdAt - a.createdAt);
            const allActions = Array.from(new Set(sorted.map(event => event.action)));
            const targetIds = Array.from(new Set(sorted.map(event => event.targetId).filter((id): id is string => Boolean(id))));
            const timestamps = sorted.map(event => event.createdAt);
            return {
                sessionId,
                startAt: Math.min(...timestamps),
                endAt: Math.max(...timestamps),
                eventCount: sorted.length,
                actions: allActions,
                targetIds,
                recentEvents: sorted.slice(0, 8)
            };
        })
        .sort((a, b) => b.endAt - a.endAt)
        .slice(0, limit);

    return {
        mode: 'temporal',
        contextId,
        sinceHours,
        totalEvents: windowed.length,
        sessions: grouped
    };
}

function mapTopicHit(hit: SearchResult): {
    nodeId: string;
    key: string | null;
    type: string;
    content: string;
    tags: string[];
    createdAt: number;
    score: number;
    matchReason: string;
    matchedTerms: string[];
} {
    return {
        nodeId: hit.node.id,
        key: hit.node.key ?? null,
        type: hit.node.type,
        content: hit.node.content,
        tags: hit.node.tags ?? [],
        createdAt: hit.node.createdAt,
        score: hit.score,
        matchReason: hit.matchReason,
        matchedTerms: hit.matchedTerms
    };
}

function getTopicHits(
    graph: Graph,
    contextId: string,
    query: string,
    limit: number,
    sinceHours: number
): SearchResult[] {
    const feedbackByNode = collectRecallFeedbackSignals(graph, contextId);
    const applyFeedback = (hits: SearchResult[]): SearchResult[] => {
        if (hits.length === 0 || feedbackByNode.size === 0) return hits;
        const rescored = hits.map(hit => {
            const signal = feedbackByNode.get(hit.node.id);
            if (!signal) return hit;
            return {
                ...hit,
                score: Math.max(0, Number((hit.score + signal.netAdjustment).toFixed(2)))
            };
        });
        rescored.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return b.node.createdAt - a.node.createdAt;
        });
        return rescored.slice(0, limit);
    };

    const withAdvanced = graph as Graph & {
        searchAdvanced?: (contextId: string, query: string, options?: { limit?: number; sinceMs?: number; includeSuperseded?: boolean }) => SearchResult[];
    };

    if (typeof withAdvanced.searchAdvanced === 'function') {
        const hits = withAdvanced.searchAdvanced(contextId, query, {
            limit,
            sinceMs: sinceHours * 60 * 60 * 1000,
            includeSuperseded: false
        });
        return applyFeedback(hits);
    }

    const legacyNodes = graph.search(contextId, query, limit);
    const hits: SearchResult[] = legacyNodes.map((node, idx): SearchResult => ({
        node,
        score: Math.max(0, 100 - idx * 10),
        matchReason: 'exact_term',
        matchedTerms: query.toLowerCase().match(/[a-z0-9_]+/g) ?? []
    }));
    return applyFeedback(hits);
}

function buildGraphRecall(
    graph: Graph,
    contextId: string,
    options: {
        query?: string;
        limit: number;
        sinceMs: number;
        depth: number;
        maxNodes: number;
        anchorNodeIds?: string[];
    }
): {
    mode: 'graph';
    contextId: string;
    anchors: Array<{ nodeId: string; score: number | null; source: 'query' | 'explicit' }>;
    subgraph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
} {
    const anchors: Array<{ nodeId: string; score: number | null; source: 'query' | 'explicit' }> = [];

    if (options.query && options.query.trim().length > 0) {
        const topicHits = getTopicHits(
            graph,
            contextId,
            options.query,
            options.limit,
            Math.max(1, options.sinceMs / (60 * 60 * 1000))
        );
        for (const hit of topicHits) {
            anchors.push({ nodeId: hit.node.id, score: hit.score, source: 'query' });
        }
    }

    if (Array.isArray(options.anchorNodeIds)) {
        for (const nodeId of options.anchorNodeIds) {
            if (typeof nodeId !== 'string' || nodeId.length === 0) continue;
            if (anchors.some(anchor => anchor.nodeId === nodeId)) continue;
            anchors.push({ nodeId, score: null, source: 'explicit' });
        }
    }

    const selectedAnchors = anchors.slice(0, options.limit);
    const nodeMap = new Map<string, Record<string, unknown>>();
    const edgeMap = new Map<string, Record<string, unknown>>();

    for (const anchor of selectedAnchors) {
        const subgraph = graph.getSubgraph(anchor.nodeId, options.depth, options.maxNodes);
        for (const node of subgraph.nodes) {
            nodeMap.set(node.id, {
                id: node.id,
                contextId: node.contextId,
                type: node.type,
                content: node.content,
                key: node.key ?? null,
                tags: node.tags ?? [],
                createdAt: node.createdAt
            });
        }
        for (const edge of subgraph.edges) {
            edgeMap.set(edge.id, {
                id: edge.id,
                fromId: edge.fromId,
                toId: edge.toId,
                relation: edge.relation,
                createdAt: edge.createdAt
            });
        }
    }

    return {
        mode: 'graph',
        contextId,
        anchors: selectedAnchors,
        subgraph: {
            nodes: Array.from(nodeMap.values()),
            edges: Array.from(edgeMap.values())
        }
    };
}

function recordMutationEvent(
    runtime: HandlerRuntimeContext,
    connectionId: string,
    req: DaemonRequest,
    contextId: string | null,
    params: RequestParams,
    result: unknown
): void {
    runtime.eventRuntime?.emitMutation({
        method: req.method,
        contextId,
        source: toEventSource(connectionId, req),
        payload: toEventPayload(params, result)
    });
}

export function handleRequest(
    graph: Graph,
    connectionId: string,
    req: DaemonRequest,
    runtime: HandlerRuntimeContext
): unknown {
    const params = getParams(req);
    const session = req.sessionToken ? touchSession(req.sessionToken) : null;
    const sessionContextId = session?.contextId ?? null;

    assertValidSession(req, Boolean(session));

    if (req.method === 'health') {
        const auth = readAuthState();
        return {
            status: 'ok',
            timestamp: Date.now(),
            uptimeMs: Date.now() - runtime.startedAt,
            metrics: runtime.getMetricsSnapshot ? runtime.getMetricsSnapshot() : null,
            auth: {
                authenticated: auth.authenticated,
                email: auth.email,
                tenantId: auth.tenantId,
                tokenExpired: auth.tokenExpired
            },
            sync: runtime.syncEngine ? runtime.syncEngine.getStatus() : null
        };
    }

    if (req.method === 'metricsSnapshot') {
        return runtime.getMetricsSnapshot ? runtime.getMetricsSnapshot() : null;
    }

    if (req.method === 'getCapabilities') {
        return {
            apiVersion: '2',
            features: ['sessions', 'workstream_briefs', 'health', 'capabilities', 'audit_logs', 'audit_verify', 'metrics', 'backup_restore', 'auth', 'sync', 'sync_policies', 'data_policy', 'blackboard_events', 'task_leases', 'quality_gates', 'recall', 'recall_feedback', 'chat_payloads', 'hook_health'],
            methods: [
                'listContexts', 'createContext', 'deleteContext', 'switchContext', 'getActiveContext',
                'addNode', 'getNode', 'updateNode', 'getByKey', 'deleteNode',
                'addEdge', 'getSubgraph', 'search', 'getGraphData',
                  'listChatSessions', 'listChatTurns', 'getNodePayload', 'getHookHealth',
                'listBranchLanes', 'getWorkstreamBrief', 'getAgentContextPack', 'compareWorkstreams', 'compareWorkspaces', 'listBranchSessions', 'listSessionMessages',
                'listBranchCheckpoints', 'getSessionDetail', 'getCheckpointDetail',
                  'getHandoffTimeline', 'previewSessionKnowledge', 'previewCheckpointKnowledge',
                  'extractSessionKnowledge', 'extractCheckpointKnowledge', 'promoteInsight',
                  'saveCheckpoint', 'createSessionCheckpoint', 'rewind', 'rewindCheckpoint', 'listCheckpoints', 'resumeSession', 'explainCheckpoint',
                'createSession', 'refreshSession', 'health', 'getCapabilities', 'metricsSnapshot',
                'listAuditEvents', 'listRecallFeedback', 'createBackup', 'listBackups', 'restoreBackup',
                'auth/status', 'syncStatus', 'syncNow', 'getSyncPolicy', 'setSyncPolicy', 'getDataPolicy', 'setDataPolicy', 'shutdown',
                'subscribeEvents', 'unsubscribeEvents', 'listSubscriptions', 'pollEvents', 'ackEvent',
                'getBlackboardState', 'evaluateCompletion', 'claimTask', 'releaseTask', 'resolveGate',
                'recallTemporal', 'recallTopic', 'recallGraph', 'recall', 'recallFeedback'
            ]
        };
    }

    if (req.method === 'subscribeEvents') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }

        const subscription = runtime.eventRuntime.subscribe({
            contextId: typeof params.contextId === 'string' && params.contextId.length > 0 ? params.contextId : resolveContextId(connectionId, params, sessionContextId) ?? undefined,
            types: params.types,
            afterSequence: typeof params.afterSequence === 'number' ? params.afterSequence : undefined
        }, {
            connectionId,
            sessionToken: req.sessionToken
        });
        return subscription;
    }

    if (req.method === 'listSubscriptions') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }

        return runtime.eventRuntime.listSubscriptions({
            connectionId,
            sessionToken: req.sessionToken
        });
    }

    if (req.method === 'unsubscribeEvents') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }

        const subscriptionId = typeof params.subscriptionId === 'string' ? params.subscriptionId : null;
        if (!subscriptionId) {
            throw new Error("Missing required 'subscriptionId' for unsubscribeEvents.");
        }

        return runtime.eventRuntime.unsubscribe(subscriptionId, {
            connectionId,
            sessionToken: req.sessionToken
        });
    }

    if (req.method === 'pollEvents') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }

        const subscriptionId = typeof params.subscriptionId === 'string' ? params.subscriptionId : null;
        if (!subscriptionId) {
            throw new Error("Missing required 'subscriptionId' for pollEvents.");
        }

        return runtime.eventRuntime.poll({
            subscriptionId,
            afterSequence: typeof params.afterSequence === 'number' ? params.afterSequence : undefined,
            limit: typeof params.limit === 'number' ? params.limit : undefined
        }, {
            connectionId,
            sessionToken: req.sessionToken
        });
    }

    if (req.method === 'ackEvent') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }

        const subscriptionId = typeof params.subscriptionId === 'string' ? params.subscriptionId : null;
        if (!subscriptionId) {
            throw new Error("Missing required 'subscriptionId' for ackEvent.");
        }

        return runtime.eventRuntime.ack({
            subscriptionId,
            eventId: typeof params.eventId === 'string' ? params.eventId : undefined,
            sequence: typeof params.sequence === 'number' ? params.sequence : undefined
        }, {
            connectionId,
            sessionToken: req.sessionToken
        });
    }

    if (req.method === 'getBlackboardState') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        return runtime.eventRuntime.getBlackboardState({
            contextId: typeof params.contextId === 'string' ? params.contextId : undefined,
            limit: typeof params.limit === 'number' ? params.limit : undefined
        });
    }

    if (req.method === 'evaluateCompletion') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        return runtime.eventRuntime.evaluateCompletion({
            contextId: typeof params.contextId === 'string' ? params.contextId : undefined,
            cooldownMs: typeof params.cooldownMs === 'number' ? params.cooldownMs : undefined,
            requiredGates: params.requiredGates
        });
    }

    if (req.method === 'claimTask') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        const taskId = typeof params.taskId === 'string' ? params.taskId : null;
        if (!taskId) {
            throw new Error("Missing required 'taskId' for claimTask.");
        }
        const resolvedContextId = resolveContextId(connectionId, params, sessionContextId) ?? undefined;
        return runtime.eventRuntime.claimTask({
            taskId,
            contextId: resolvedContextId,
            leaseMs: typeof params.leaseMs === 'number' ? params.leaseMs : undefined
        }, {
            connectionId,
            sessionToken: req.sessionToken
        });
    }

    if (req.method === 'releaseTask') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        const taskId = typeof params.taskId === 'string' ? params.taskId : null;
        if (!taskId) {
            throw new Error("Missing required 'taskId' for releaseTask.");
        }
        return runtime.eventRuntime.releaseTask({ taskId }, {
            connectionId,
            sessionToken: req.sessionToken
        });
    }

    if (req.method === 'resolveGate') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        const gateId = typeof params.gateId === 'string' ? params.gateId : null;
        if (!gateId) {
            throw new Error("Missing required 'gateId' for resolveGate.");
        }
        const resolvedContextId = resolveContextId(connectionId, params, sessionContextId) ?? undefined;
        return runtime.eventRuntime.resolveGate({
            gateId,
            contextId: resolvedContextId,
            severity: typeof params.severity === 'string' ? params.severity : undefined,
            status: params.status === 'open' ? 'open' : 'resolved',
            message: typeof params.message === 'string' ? params.message : undefined
        }, {
            connectionId,
            sessionToken: req.sessionToken
        });
    }

    if (req.method === 'syncStatus') {
        return runtime.syncEngine ? runtime.syncEngine.getStatus() : { enabled: false, running: false, lastPushAt: null, lastPullAt: null, lastError: null, queue: { pending: 0, inFlight: 0, failed: 0, done: 0 } };
    }

    if (req.method === 'syncNow') {
        if (!runtime.syncEngine) {
            throw new Error('Sync engine not available');
        }
        // syncNow is async but handleRequest is sync — fire and return status
        void runtime.syncEngine.syncNow();
        return runtime.syncEngine.getStatus();
    }

    if (req.method === 'createSession') {
        const contextId = getContextIdFromParams(params) || getConnectionContext(connectionId);
        if (contextId && !graph.getContext(contextId)) {
            throw new Error(`Context ${contextId} not found`);
        }

        return createSession(contextId);
    }

    if (req.method === 'refreshSession') {
        if (!req.sessionToken) {
            throw new Error("Missing required 'sessionToken'.");
        }

        const refreshed = touchSession(req.sessionToken);
        if (!refreshed) {
            throw new Error(`Invalid sessionToken '${req.sessionToken}'`);
        }

        return refreshed;
    }

    if (req.method === 'auth/status') {
        return readAuthState();
    }

    if (req.method === 'listContexts') {
        return graph.listContexts();
    }

    if (req.method === 'getHookHealth') {
        return readHookHealth();
    }

    const contextId = resolveContextId(connectionId, params, sessionContextId);

    if (CONTEXT_REQUIRED_METHODS.has(req.method) && !contextId) {
        throw new Error("No active context set! Call 'switchContext' or 'createContext' first, or provide contextId in params.");
    }

    if (req.method === 'getActiveContext') {
        return contextId ? graph.getContext(contextId) : null;
    }

    if (req.method === 'listAuditEvents') {
        const explicitContextId = getContextIdFromParams(params);
        const limit = typeof params.limit === 'number' ? params.limit : undefined;
        return graph.listAuditEvents(explicitContextId ?? undefined, limit);
    }

    if (req.method === 'listRecallFeedback') {
        const explicitContextId = getContextIdFromParams(params);
        const feedbackContextId = explicitContextId ?? contextId ?? undefined;
        const limit = parsePositiveInt(params.limit, 50, 500);
        const nodeIdFilter = typeof params.nodeId === 'string' && params.nodeId.trim().length > 0
            ? params.nodeId.trim()
            : null;
        const helpfulFilter = typeof params.helpful === 'boolean' ? params.helpful : null;

        const events = graph
            .listAuditEvents(feedbackContextId, Math.max(limit * 10, 200))
            .filter(event => event.action === 'recall_feedback');

        const items = events
            .map(event => parseRecallFeedbackSignal(event))
            .filter((signal): signal is RecallFeedbackSignal => Boolean(signal))
            .filter(signal => (nodeIdFilter ? signal.nodeId === nodeIdFilter : true))
            .filter(signal => (helpfulFilter === null ? true : signal.helpful === helpfulFilter))
            .slice(0, limit);

        const nodeSummary = new Map<string, {
            nodeId: string;
            helpful: number;
            notHelpful: number;
            netScore: number;
            lastFeedbackAt: number;
        }>();
        for (const item of items) {
            const current = nodeSummary.get(item.nodeId) ?? {
                nodeId: item.nodeId,
                helpful: 0,
                notHelpful: 0,
                netScore: 0,
                lastFeedbackAt: 0
            };
            if (item.helpful) {
                current.helpful += 1;
            } else {
                current.notHelpful += 1;
            }
            current.netScore = current.helpful - current.notHelpful;
            current.lastFeedbackAt = Math.max(current.lastFeedbackAt, item.createdAt);
            nodeSummary.set(item.nodeId, current);
        }

        const helpfulCount = items.filter(item => item.helpful).length;
        const notHelpfulCount = items.length - helpfulCount;

        return {
            contextId: feedbackContextId ?? null,
            total: items.length,
            helpfulCount,
            notHelpfulCount,
            nodeSummary: Array.from(nodeSummary.values())
                .sort((a, b) => b.netScore - a.netScore || b.lastFeedbackAt - a.lastFeedbackAt)
                .slice(0, 20),
            items
        };
    }

    if (req.method === 'recallTemporal') {
        const sinceHours = parsePositiveHours(params.sinceHours, 24);
        const limit = parsePositiveInt(params.limit, 10, 100);
        return buildTemporalRecall(graph, contextId, sinceHours, limit);
    }

    if (req.method === 'recallTopic') {
        if (!contextId) {
            throw new Error("No active context set for recallTopic. Call 'switchContext' or provide contextId.");
        }
        const query = typeof params.query === 'string' ? params.query.trim() : '';
        if (!query) {
            throw new Error("Missing required 'query' for recallTopic.");
        }
        const limit = parsePositiveInt(params.limit, 10, 100);
        const sinceHours = parsePositiveHours(params.sinceHours, 24);
        const hits = getTopicHits(graph, contextId, query, limit, sinceHours);
        return {
            mode: 'topic',
            contextId,
            query,
            sinceHours,
            hits: hits.map(mapTopicHit)
        };
    }

    if (req.method === 'recallGraph') {
        if (!contextId) {
            throw new Error("No active context set for recallGraph. Call 'switchContext' or provide contextId.");
        }
        const limit = parsePositiveInt(params.limit, 6, 40);
        const sinceHours = parsePositiveHours(params.sinceHours, 24);
        const depth = parseDepth(params.depth, 2);
        const maxNodes = parsePositiveInt(params.maxNodes, 30, 200);
        const query = typeof params.query === 'string' ? params.query.trim() : undefined;
        const anchorNodeIds = Array.isArray(params.anchorNodeIds)
            ? params.anchorNodeIds.filter((id): id is string => typeof id === 'string')
            : undefined;

        return buildGraphRecall(graph, contextId, {
            query,
            limit,
            sinceMs: sinceHours * 60 * 60 * 1000,
            depth,
            maxNodes,
            anchorNodeIds
        });
    }

    if (req.method === 'recall') {
        const mode = typeof params.mode === 'string' ? params.mode : 'auto';
        if (mode === 'temporal') {
            const sinceHours = parsePositiveHours(params.sinceHours, 24);
            const limit = parsePositiveInt(params.limit, 10, 100);
            return buildTemporalRecall(graph, contextId, sinceHours, limit);
        }
        if (mode === 'topic') {
            if (!contextId) {
                throw new Error("No active context set for recall topic mode. Call 'switchContext' or provide contextId.");
            }
            const query = typeof params.query === 'string' ? params.query.trim() : '';
            if (!query) {
                throw new Error("Missing required 'query' for recall topic mode.");
            }
            const limit = parsePositiveInt(params.limit, 10, 100);
            const sinceHours = parsePositiveHours(params.sinceHours, 24);
            const hits = getTopicHits(graph, contextId, query, limit, sinceHours);
            return {
                mode: 'topic',
                contextId,
                query,
                sinceHours,
                hits: hits.map(mapTopicHit)
            };
        }
        if (mode === 'graph') {
            if (!contextId) {
                throw new Error("No active context set for recall graph mode. Call 'switchContext' or provide contextId.");
            }
            const limit = parsePositiveInt(params.limit, 6, 40);
            const sinceHours = parsePositiveHours(params.sinceHours, 24);
            const depth = parseDepth(params.depth, 2);
            const maxNodes = parsePositiveInt(params.maxNodes, 30, 200);
            const query = typeof params.query === 'string' ? params.query.trim() : undefined;
            const anchorNodeIds = Array.isArray(params.anchorNodeIds)
                ? params.anchorNodeIds.filter((id): id is string => typeof id === 'string')
                : undefined;
            return buildGraphRecall(graph, contextId, {
                query,
                limit,
                sinceMs: sinceHours * 60 * 60 * 1000,
                depth,
                maxNodes,
                anchorNodeIds
            });
        }

        const sinceHours = parsePositiveHours(params.sinceHours, 24);
        const limit = parsePositiveInt(params.limit, 10, 100);
        const depth = parseDepth(params.depth, 2);
        const maxNodes = parsePositiveInt(params.maxNodes, 30, 200);
        const query = typeof params.query === 'string' ? params.query.trim() : '';

        const temporal = buildTemporalRecall(graph, contextId, sinceHours, limit);
        const topic = (contextId && query)
            ? {
                mode: 'topic' as const,
                contextId,
                query,
                sinceHours,
                hits: getTopicHits(graph, contextId, query, limit, sinceHours).map(mapTopicHit)
            }
            : null;
        const graphRecall = (contextId && query)
            ? buildGraphRecall(graph, contextId, {
                query,
                limit: Math.min(limit, 8),
                sinceMs: sinceHours * 60 * 60 * 1000,
                depth,
                maxNodes
            })
            : null;

        const recommendations = topic
            ? topic.hits.slice(0, 3).map(hit => ({
                kind: 'node',
                nodeId: hit.nodeId,
                score: hit.score,
                reason: hit.matchReason
            }))
            : [];

        return {
            mode: 'auto',
            contextId,
            summary: {
                query: query || null,
                sessionCount: temporal.sessions.length,
                recentEventCount: temporal.totalEvents,
                topicHitCount: topic?.hits.length ?? 0,
                graphNodeCount: graphRecall?.subgraph.nodes.length ?? 0
            },
            temporal,
            topic,
            graph: graphRecall,
            recommendations
        };
    }

    if (req.method === 'recallFeedback') {
        const nodeId = typeof params.nodeId === 'string' ? params.nodeId.trim() : '';
        if (!nodeId) {
            throw new Error("Missing required 'nodeId' for recallFeedback.");
        }
        const helpful = typeof params.helpful === 'boolean' ? params.helpful : null;
        if (helpful === null) {
            throw new Error("Missing required boolean 'helpful' for recallFeedback.");
        }
        const reason = typeof params.reason === 'string' && params.reason.trim().length > 0
            ? params.reason.trim()
            : null;
        const feedbackContextId = getContextIdFromParams(params) ?? contextId;
        const metadata = toAuditMetadata(connectionId, req, params);
        const recordedAt = Date.now();

        graph.recordAuditEvent({
            action: 'recall_feedback',
            contextId: feedbackContextId,
            payload: {
                method: req.method,
                params: {
                    nodeId,
                    helpful,
                    reason,
                    contextId: feedbackContextId
                }
            },
            result: {
                accepted: true,
                recordedAt
            },
            metadata
        });

        return {
            ok: true,
            nodeId,
            helpful,
            reason,
            contextId: feedbackContextId,
            recordedAt
        };
    }

    // SEC-001: Audit chain integrity verification
    if (req.method === 'auditVerify') {
        const limit = typeof params.limit === 'number' ? params.limit : 1000;
        return graph.verifyAuditChain(limit);
    }

    if (req.method === 'listBackups') {
        return listBackups();
    }

    const auditMetadata = toAuditMetadata(connectionId, req, params);

    switch (req.method) {
        case 'createContext': {
            const name = typeof params.name === 'string' ? params.name : null;
            if (!name) throw new Error("Missing required 'name' for createContext.");

            const paths = Array.isArray(params.paths) ? params.paths.filter((p): p is string => typeof p === 'string') : [];
            const syncPolicy = parseSyncPolicy(params.syncPolicy) ?? 'metadata_only';
            const ctx = graph.createContext(name, paths, syncPolicy);
            syncActiveContext(connectionId, req.sessionToken, ctx.id);

            recordMutationAudit(graph, req, 'create_context', ctx.id, params, { contextId: ctx.id }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, ctx.id, params, { contextId: ctx.id });
            return ctx;
        }
        case 'deleteContext': {
            const id = typeof params.id === 'string' ? params.id : null;
            if (!id) throw new Error("Missing required 'id' for deleteContext.");

            graph.deleteContext(id);

            if (getConnectionContext(connectionId) === id) {
                clearConnectionContext(connectionId);
            }

            if (req.sessionToken && sessionContextId === id) {
                clearSessionContext(req.sessionToken);
            }

            const result = { success: true };
            recordMutationAudit(graph, req, 'delete_context', id, params, result, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, id, params, result);
            return result;
        }
        case 'switchContext': {
            const targetContextId = typeof params.contextId === 'string' ? params.contextId : null;
            if (!targetContextId) throw new Error("Missing required 'contextId' for switchContext.");

            const ctx = graph.getContext(targetContextId);
            if (!ctx) throw new Error(`Context ${targetContextId} not found`);

            syncActiveContext(connectionId, req.sessionToken, ctx.id);
            recordMutationAudit(graph, req, 'switch_context', ctx.id, params, { contextId: ctx.id }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, ctx.id, params, { contextId: ctx.id });
            return ctx;
        }
        case 'addNode': {
            const result = graph.addNode({ ...params, contextId: contextId! } as Parameters<Graph['addNode']>[0]);
            recordMutationAudit(graph, req, 'add_node', contextId, params, { id: result.id, contextId: result.contextId }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, { id: result.id, contextId: result.contextId });
            runtime.syncEngine?.enqueue(contextId!);
            return result;
        }
        case 'getNode':
            return graph.getNode(params.id as string);
        case 'updateNode': {
            const result = graph.updateNode(params.id as string, params.updates as Parameters<Graph['updateNode']>[1]);
            recordMutationAudit(graph, req, 'update_node', contextId, params, { id: params.id as string, updated: Boolean(result) }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, { id: params.id as string, updated: Boolean(result) });
            if (contextId) runtime.syncEngine?.enqueue(contextId);
            return result;
        }
        case 'getByKey':
            return graph.getByKey(contextId!, params.key as string, {
                includeHidden: params.includeHidden === true
            });
        case 'deleteNode': {
            graph.deleteNode(params.id as string);
            const result = { success: true };
            recordMutationAudit(graph, req, 'delete_node', contextId, params, result, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, result);
            if (contextId) runtime.syncEngine?.enqueue(contextId);
            return result;
        }
        case 'addEdge': {
            const result = graph.addEdge(params.fromId as string, params.toId as string, params.relation as Parameters<Graph['addEdge']>[2]);
            recordMutationAudit(graph, req, 'add_edge', contextId, params, { id: result.id }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, { id: result.id });
            if (contextId) runtime.syncEngine?.enqueue(contextId);
            return result;
        }
        case 'getSubgraph':
            return graph.getSubgraph(params.rootId as string, params.depth as number | undefined, params.maxNodes as number | undefined);
        case 'search':
            return graph.search(
                contextId!,
                params.query as string,
                params.limit as number | undefined,
                { includeHidden: params.includeHidden === true }
            );
        case 'getGraphData':
            return graph.getGraphData(contextId!, { includeHidden: params.includeHidden === true });
        case 'listChatSessions':
            return graph.listChatSessions(contextId!, params.limit as number | undefined);
        case 'listChatTurns': {
            const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
            if (!sessionId || sessionId.trim().length === 0) {
                throw new Error("Missing required 'sessionId' for listChatTurns.");
            }
            return graph.listChatTurns(contextId!, sessionId, params.limit as number | undefined);
        }
        case 'listBranchLanes':
            return (() => {
                const context = graph.getContext(contextId!);
                const contextPaths = Array.isArray(context?.paths)
                    ? context.paths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
                    : [];
                return graph.listBranchLanes(contextId!, params.limit as number | undefined)
                    .map((lane) => enrichWorkstreamLane(graph, contextId!, contextPaths, lane));
            })();
        case 'listWorkstreamInsights':
            return graph.listWorkstreamInsights(contextId!, {
                branch: typeof params.branch === 'string' ? params.branch : null,
                worktreePath: typeof params.worktreePath === 'string' ? params.worktreePath : null,
                limit: params.limit as number | undefined
            });
        case 'getWorkstreamBrief':
            return buildWorkstreamBrief(graph, contextId!, {
                branch: typeof params.branch === 'string' ? params.branch : null,
                worktreePath: typeof params.worktreePath === 'string' ? params.worktreePath : null,
                sessionLimit: params.sessionLimit as number | undefined,
                checkpointLimit: params.checkpointLimit as number | undefined
            });
        case 'getAgentContextPack':
            return buildAgentContextPack(graph, contextId!, {
                branch: typeof params.branch === 'string' ? params.branch : null,
                worktreePath: typeof params.worktreePath === 'string' ? params.worktreePath : null,
                sessionLimit: params.sessionLimit as number | undefined,
                checkpointLimit: params.checkpointLimit as number | undefined,
                handoffLimit: params.handoffLimit as number | undefined
            });
        case 'compareWorkstreams': {
            const sourceBranch = typeof params.sourceBranch === 'string' ? params.sourceBranch.trim() : '';
            const targetBranch = typeof params.targetBranch === 'string' ? params.targetBranch.trim() : '';
            if (!sourceBranch) {
                throw new Error("Missing required 'sourceBranch' for compareWorkstreams.");
            }
            if (!targetBranch) {
                throw new Error("Missing required 'targetBranch' for compareWorkstreams.");
            }
            return compareWorkstreams(graph, contextId!, {
                sourceBranch,
                targetBranch,
                sourceWorktreePath: typeof params.sourceWorktreePath === 'string' ? params.sourceWorktreePath : null,
                targetWorktreePath: typeof params.targetWorktreePath === 'string' ? params.targetWorktreePath : null,
                sessionLimit: params.sessionLimit as number | undefined,
                checkpointLimit: params.checkpointLimit as number | undefined
            });
        }
        case 'compareWorkspaces': {
            const sourceContextId = typeof params.sourceContextId === 'string' && params.sourceContextId.trim().length > 0
                ? params.sourceContextId.trim()
                : contextId;
            const targetContextId = typeof params.targetContextId === 'string' && params.targetContextId.trim().length > 0
                ? params.targetContextId.trim()
                : null;
            if (!sourceContextId) {
                throw new Error("Missing required 'sourceContextId' or active context for compareWorkspaces.");
            }
            if (!targetContextId) {
                throw new Error("Missing required 'targetContextId' for compareWorkspaces.");
            }
            return compareWorkspaces(graph, {
                sourceContextId,
                targetContextId
            });
        }
        case 'listBranchSessions': {
            const branch = typeof params.branch === 'string' ? params.branch : null;
            if (!branch || branch.trim().length === 0) {
                throw new Error("Missing required 'branch' for listBranchSessions.");
            }
            return graph.listBranchSessions(contextId!, branch, {
                worktreePath: typeof params.worktreePath === 'string' ? params.worktreePath : null,
                limit: params.limit as number | undefined
            });
        }
        case 'listSessionMessages': {
            const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
            if (!sessionId || sessionId.trim().length === 0) {
                throw new Error("Missing required 'sessionId' for listSessionMessages.");
            }
            return graph.listSessionMessages(contextId!, sessionId, params.limit as number | undefined);
        }
        case 'listBranchCheckpoints': {
            const branch = typeof params.branch === 'string' ? params.branch : null;
            if (!branch || branch.trim().length === 0) {
                throw new Error("Missing required 'branch' for listBranchCheckpoints.");
            }
            return graph.listBranchCheckpoints(contextId!, branch, {
                worktreePath: typeof params.worktreePath === 'string' ? params.worktreePath : null,
                limit: params.limit as number | undefined
            });
        }
        case 'getSessionDetail': {
            const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
            if (!sessionId || sessionId.trim().length === 0) {
                throw new Error("Missing required 'sessionId' for getSessionDetail.");
            }
            return graph.getSessionDetail(contextId!, sessionId);
        }
        case 'getCheckpointDetail': {
            const checkpointId = typeof params.checkpointId === 'string' ? params.checkpointId : null;
            if (!checkpointId || checkpointId.trim().length === 0) {
                throw new Error("Missing required 'checkpointId' for getCheckpointDetail.");
            }
            return graph.getCheckpointDetail(checkpointId);
        }
        case 'getHandoffTimeline':
            return graph.getHandoffTimeline(
                contextId!,
                typeof params.branch === 'string' ? params.branch : undefined,
                typeof params.worktreePath === 'string' ? params.worktreePath : null,
                params.limit as number | undefined
            );
        case 'previewSessionKnowledge': {
            const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
            if (!sessionId || sessionId.trim().length === 0) {
                throw new Error("Missing required 'sessionId' for previewSessionKnowledge.");
            }
            return graph.previewKnowledgeFromSession(contextId!, sessionId, {
                checkpointId: typeof params.checkpointId === 'string' ? params.checkpointId : null,
                maxNodes: params.maxNodes as number | undefined,
                minConfidence: typeof params.minConfidence === 'number' ? params.minConfidence : undefined,
                source: params.source === 'checkpoint' ? 'checkpoint' : 'session'
            });
        }
        case 'extractSessionKnowledge': {
            const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
            if (!sessionId || sessionId.trim().length === 0) {
                throw new Error("Missing required 'sessionId' for extractSessionKnowledge.");
            }
            const result = graph.extractKnowledgeFromSession(contextId!, sessionId, {
                checkpointId: typeof params.checkpointId === 'string' ? params.checkpointId : null,
                maxNodes: params.maxNodes as number | undefined,
                minConfidence: typeof params.minConfidence === 'number' ? params.minConfidence : undefined,
                source: params.source === 'checkpoint' ? 'checkpoint' : 'session',
                allowedKeys: parseStringArray(params.candidateKeys)
            });
            recordMutationAudit(graph, req, 'extract_knowledge', contextId, params, {
                sessionId,
                checkpointId: result.checkpointId,
                createdCount: result.createdCount,
                reusedCount: result.reusedCount,
                nodeCount: result.nodeCount
            }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, {
                sessionId,
                checkpointId: result.checkpointId,
                createdCount: result.createdCount,
                reusedCount: result.reusedCount,
                nodeCount: result.nodeCount
            });
            runtime.syncEngine?.enqueue(contextId!);
            return result;
        }
        case 'promoteInsight': {
            const sourceContextId = typeof params.sourceContextId === 'string' ? params.sourceContextId : null;
            const nodeId = typeof params.nodeId === 'string' ? params.nodeId : null;
            if (!sourceContextId || sourceContextId.trim().length === 0) {
                throw new Error("Missing required 'sourceContextId' for promoteInsight.");
            }
            if (!nodeId || nodeId.trim().length === 0) {
                throw new Error("Missing required 'nodeId' for promoteInsight.");
            }
            const result = graph.promoteInsightNode(sourceContextId, nodeId, contextId!, {
                branch: typeof params.branch === 'string' ? params.branch : undefined,
                worktreePath: typeof params.worktreePath === 'string' ? params.worktreePath : undefined
            });
            recordMutationAudit(graph, req, 'promote_insight', contextId, params, {
                sourceContextId,
                nodeId,
                targetNodeId: result.targetNodeId,
                created: result.created,
                reused: result.reused
            }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, {
                sourceContextId,
                nodeId,
                targetNodeId: result.targetNodeId,
                created: result.created,
                reused: result.reused
            });
            runtime.syncEngine?.enqueue(contextId!);
            return result;
        }
        case 'previewCheckpointKnowledge': {
            const checkpointId = typeof params.checkpointId === 'string' ? params.checkpointId : null;
            if (!checkpointId || checkpointId.trim().length === 0) {
                throw new Error("Missing required 'checkpointId' for previewCheckpointKnowledge.");
            }
            return graph.previewKnowledgeFromCheckpoint(checkpointId, {
                maxNodes: params.maxNodes as number | undefined,
                minConfidence: typeof params.minConfidence === 'number' ? params.minConfidence : undefined
            });
        }
        case 'extractCheckpointKnowledge': {
            const checkpointId = typeof params.checkpointId === 'string' ? params.checkpointId : null;
            if (!checkpointId || checkpointId.trim().length === 0) {
                throw new Error("Missing required 'checkpointId' for extractCheckpointKnowledge.");
            }
            const result = graph.extractKnowledgeFromCheckpoint(checkpointId, {
                maxNodes: params.maxNodes as number | undefined,
                minConfidence: typeof params.minConfidence === 'number' ? params.minConfidence : undefined,
                allowedKeys: parseStringArray(params.candidateKeys)
            });
            recordMutationAudit(graph, req, 'extract_knowledge', result.contextId, params, {
                sessionId: result.sessionId,
                checkpointId,
                createdCount: result.createdCount,
                reusedCount: result.reusedCount,
                nodeCount: result.nodeCount
            }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, result.contextId, params, {
                sessionId: result.sessionId,
                checkpointId,
                createdCount: result.createdCount,
                reusedCount: result.reusedCount,
                nodeCount: result.nodeCount
            });
            runtime.syncEngine?.enqueue(result.contextId);
            return result;
        }
        case 'getNodePayload': {
            const nodeId = typeof params.nodeId === 'string' ? params.nodeId : null;
            if (!nodeId || nodeId.trim().length === 0) {
                throw new Error("Missing required 'nodeId' for getNodePayload.");
            }
            return graph.getNodePayload(nodeId);
        }
        case 'saveCheckpoint': {
            const result = graph.saveCheckpoint(contextId!, params.name as string);
            recordMutationAudit(graph, req, 'save_checkpoint', contextId, params, { id: result.id }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, { id: result.id });
            const extracted = graph.extractKnowledgeFromCheckpoint(result.id, {
                minConfidence: 0.84
            });
            if (extracted.nodeCount > 0) {
                recordMutationAudit(graph, req, 'extract_knowledge', contextId, {
                    checkpointId: result.id,
                    source: 'checkpoint:auto'
                }, {
                    sessionId: extracted.sessionId,
                    checkpointId: result.id,
                    createdCount: extracted.createdCount,
                    reusedCount: extracted.reusedCount,
                    nodeCount: extracted.nodeCount
                }, auditMetadata);
                recordMutationEvent(runtime, connectionId, req, contextId, {
                    checkpointId: result.id,
                    source: 'checkpoint:auto'
                }, {
                    sessionId: extracted.sessionId,
                    checkpointId: result.id,
                    createdCount: extracted.createdCount,
                    reusedCount: extracted.reusedCount,
                    nodeCount: extracted.nodeCount
                });
            }
            runtime.syncEngine?.enqueue(contextId!);
            return { ...result, knowledge: extracted };
        }
        case 'createSessionCheckpoint': {
            const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
            if (!sessionId || sessionId.trim().length === 0) {
                throw new Error("Missing required 'sessionId' for createSessionCheckpoint.");
            }
            const result = graph.createSessionCheckpoint(contextId!, sessionId, {
                name: typeof params.name === 'string' ? params.name : undefined,
                summary: typeof params.summary === 'string' ? params.summary : undefined,
                kind: params.kind === 'manual' || params.kind === 'session' || params.kind === 'legacy'
                    ? params.kind
                    : undefined
            });
            recordMutationAudit(graph, req, 'save_checkpoint', contextId, params, { id: result.id }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, { id: result.id });
            const extracted = graph.extractKnowledgeFromCheckpoint(result.id, {
                minConfidence: 0.84
            });
            if (extracted.nodeCount > 0) {
                recordMutationAudit(graph, req, 'extract_knowledge', contextId, {
                    checkpointId: result.id,
                    sessionId,
                    source: 'checkpoint:auto'
                }, {
                    sessionId: extracted.sessionId,
                    checkpointId: result.id,
                    createdCount: extracted.createdCount,
                    reusedCount: extracted.reusedCount,
                    nodeCount: extracted.nodeCount
                }, auditMetadata);
                recordMutationEvent(runtime, connectionId, req, contextId, {
                    checkpointId: result.id,
                    sessionId,
                    source: 'checkpoint:auto'
                }, {
                    sessionId: extracted.sessionId,
                    checkpointId: result.id,
                    createdCount: extracted.createdCount,
                    reusedCount: extracted.reusedCount,
                    nodeCount: extracted.nodeCount
                });
            }
            runtime.syncEngine?.enqueue(contextId!);
            return { ...result, knowledge: extracted };
        }
        case 'rewind': {
            graph.rewind(params.checkpointId as string);
            const result = { success: true };
            recordMutationAudit(graph, req, 'rewind', contextId, params, result, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, result);
            if (contextId) runtime.syncEngine?.enqueue(contextId);
            return result;
        }
        case 'rewindCheckpoint': {
            const checkpointId = typeof params.checkpointId === 'string' ? params.checkpointId : null;
            if (!checkpointId || checkpointId.trim().length === 0) {
                throw new Error("Missing required 'checkpointId' for rewindCheckpoint.");
            }
            const detail = graph.rewindCheckpoint(checkpointId);
            recordMutationAudit(graph, req, 'rewind', detail.checkpoint.contextId, params, { checkpointId }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, detail.checkpoint.contextId, params, { checkpointId });
            runtime.syncEngine?.enqueue(detail.checkpoint.contextId);
            return detail;
        }
        case 'listCheckpoints':
            return graph.listCheckpoints(contextId!);
        case 'resumeSession': {
            const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
            if (!sessionId || sessionId.trim().length === 0) {
                throw new Error("Missing required 'sessionId' for resumeSession.");
            }
            const detail = graph.resumeSession(contextId!, sessionId);
            recordMutationAudit(graph, req, 'resume_session', contextId, params, {
                sessionId,
                checkpointCount: detail.checkpointCount
            }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, {
                sessionId,
                checkpointCount: detail.checkpointCount
            });
            return detail;
        }
        case 'explainCheckpoint': {
            const checkpointId = typeof params.checkpointId === 'string' ? params.checkpointId : null;
            if (!checkpointId || checkpointId.trim().length === 0) {
                throw new Error("Missing required 'checkpointId' for explainCheckpoint.");
            }
            const detail = graph.explainCheckpoint(checkpointId);
            recordMutationAudit(graph, req, 'explain_checkpoint', detail?.checkpoint.contextId ?? contextId, params, {
                checkpointId,
                found: Boolean(detail)
            }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, detail?.checkpoint.contextId ?? contextId, params, {
                checkpointId,
                found: Boolean(detail)
            });
            return detail;
        }
        case 'getSyncPolicy': {
            const policy = graph.getContextSyncPolicy(contextId!);
            if (!policy) {
                throw new Error(`Context ${contextId} not found`);
            }
            return { contextId: contextId!, syncPolicy: policy };
        }
        case 'getDataPolicy': {
            const explicitContextId = getContextIdFromParams(params);
            const targetContextId = explicitContextId ?? resolveContextId(connectionId, params, sessionContextId) ?? null;
            if (explicitContextId && !graph.getContextSyncPolicy(explicitContextId)) {
                throw new Error(`Context ${explicitContextId} not found`);
            }
            return buildDataPolicySummary(graph, targetContextId);
        }
        case 'setDataPolicy': {
            const explicitContextId = getContextIdFromParams(params);
            const targetContextId = explicitContextId ?? resolveContextId(connectionId, params, sessionContextId) ?? null;
            if (explicitContextId && !graph.getContextSyncPolicy(explicitContextId)) {
                throw new Error(`Context ${explicitContextId} not found`);
            }
            const policy = parseSyncPolicy(params.syncPolicy);
            if (params.syncPolicy !== undefined && !policy) {
                throw new Error("Invalid syncPolicy. Expected one of: local_only, metadata_only, full_sync.");
            }
            const preset = typeof params.preset === 'string'
                && ['lean', 'review', 'debug', 'shared', 'custom'].includes(params.preset)
                ? params.preset as 'lean' | 'review' | 'debug' | 'shared' | 'custom'
                : null;
            const result = applyDataPolicyUpdate(graph, {
                contextId: targetContextId,
                preset,
                syncPolicy: policy,
                captureRetentionDays: typeof params.captureRetentionDays === 'number' ? params.captureRetentionDays : null,
                debugRetentionDays: typeof params.debugRetentionDays === 'number' ? params.debugRetentionDays : null,
                debugArtifactsEnabled: typeof params.debugArtifactsEnabled === 'boolean' ? params.debugArtifactsEnabled : null
            });
            recordMutationAudit(graph, req, 'set_data_policy', result.contextId, params, result as unknown as Record<string, unknown>, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, result.contextId, params, result as unknown as Record<string, unknown>);
            return result;
        }
        case 'shutdown': {
            runtime.requestShutdown?.();
            return { status: 'shutting_down' };
        }
        case 'setSyncPolicy': {
            const policy = parseSyncPolicy(params.syncPolicy);
            if (!policy) {
                throw new Error("Invalid syncPolicy. Expected one of: local_only, metadata_only, full_sync.");
            }
            const updated = graph.setContextSyncPolicy(contextId!, policy);
            if (!updated) {
                throw new Error(`Context ${contextId} not found`);
            }
            const result = { contextId: updated.id, syncPolicy: updated.syncPolicy };
            recordMutationAudit(graph, req, 'set_sync_policy', updated.id, params, result, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, updated.id, params, result);
            return result;
        }
        case 'createBackup': {
            const dump = graph.exportContextDump(contextId!);
            const backup = writeContextBackup({
                dump,
                backupName: typeof params.name === 'string' ? params.name : undefined,
                encrypted: typeof params.encrypted === 'boolean' ? params.encrypted : true
            });
            recordMutationAudit(graph, req, 'create_backup', contextId, params, { fileName: backup.fileName }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, { fileName: backup.fileName });
            return backup;
        }
        case 'restoreBackup': {
            const fileName = typeof params.fileName === 'string' ? params.fileName : null;
            if (!fileName) {
                throw new Error("Missing required 'fileName' for restoreBackup.");
            }

            const dump = readContextBackup(fileName);
            const restoredContext = graph.importContextDump(dump, {
                name: typeof params.name === 'string' ? params.name : undefined
            });
            recordMutationAudit(graph, req, 'restore_backup', restoredContext.id, params, { contextId: restoredContext.id }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, restoredContext.id, params, { contextId: restoredContext.id });
            return restoredContext;
        }
        default:
            throw new Error(`Unknown method: ${req.method}`);
    }
}

