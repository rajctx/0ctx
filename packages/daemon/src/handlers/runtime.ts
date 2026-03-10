import { readAuthState } from '../auth';
import { listBackups } from '../backup';
import { createSession, touchSession } from '../resolver';
import { readHookHealth } from './hook-health';
import { getContextIdFromParams, resolveContextId } from './shared';
import { handled, NOT_HANDLED, type HandlerMethodContext, type MethodDispatchResult } from './types';

export function dispatchRuntimeRequest(context: HandlerMethodContext): MethodDispatchResult {
    const { graph, connectionId, req, params, runtime, sessionContextId, contextId } = context;

    if (req.method === 'health') {
        const auth = readAuthState();
        return handled({
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
        });
    }

    if (req.method === 'metricsSnapshot') {
        return handled(runtime.getMetricsSnapshot ? runtime.getMetricsSnapshot() : null);
    }

    if (req.method === 'getCapabilities') {
        return handled({
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
        });
    }

    if (req.method === 'syncStatus') {
        return handled(runtime.syncEngine ? runtime.syncEngine.getStatus() : { enabled: false, running: false, lastPushAt: null, lastPullAt: null, lastError: null, queue: { pending: 0, inFlight: 0, failed: 0, done: 0 } });
    }

    if (req.method === 'syncNow') {
        if (!runtime.syncEngine) {
            throw new Error('Sync engine not available');
        }
        void runtime.syncEngine.syncNow();
        return handled(runtime.syncEngine.getStatus());
    }

    if (req.method === 'createSession') {
        const nextContextId = getContextIdFromParams(params) || contextId || resolveContextId(connectionId, params, sessionContextId);
        if (nextContextId && !graph.getContext(nextContextId)) {
            throw new Error(`Context ${nextContextId} not found`);
        }
        return handled(createSession(nextContextId));
    }

    if (req.method === 'refreshSession') {
        if (!req.sessionToken) {
            throw new Error("Missing required 'sessionToken'.");
        }
        const refreshed = touchSession(req.sessionToken);
        if (!refreshed) {
            throw new Error(`Invalid sessionToken '${req.sessionToken}'`);
        }
        return handled(refreshed);
    }

    if (req.method === 'auth/status') {
        return handled(readAuthState());
    }

    if (req.method === 'listContexts') {
        return handled(graph.listContexts());
    }

    if (req.method === 'getHookHealth') {
        return handled(readHookHealth());
    }

    if (req.method === 'getActiveContext') {
        return handled(contextId ? graph.getContext(contextId) : null);
    }

    if (req.method === 'listBackups') {
        return handled(listBackups());
    }

    return NOT_HANDLED;
}
