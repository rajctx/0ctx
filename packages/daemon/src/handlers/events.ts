import { resolveContextId } from './shared';
import { handled, NOT_HANDLED, type HandlerMethodContext, type MethodDispatchResult } from './types';

export function dispatchEventRequest(context: HandlerMethodContext): MethodDispatchResult {
    const { connectionId, req, params, runtime, sessionContextId } = context;

    if (req.method === 'subscribeEvents') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        return handled(runtime.eventRuntime.subscribe({
            contextId: typeof params.contextId === 'string' && params.contextId.length > 0
                ? params.contextId
                : resolveContextId(connectionId, params, sessionContextId) ?? undefined,
            types: params.types,
            afterSequence: typeof params.afterSequence === 'number' ? params.afterSequence : undefined
        }, {
            connectionId,
            sessionToken: req.sessionToken
        }));
    }

    if (req.method === 'listSubscriptions') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        return handled(runtime.eventRuntime.listSubscriptions({ connectionId, sessionToken: req.sessionToken }));
    }

    if (req.method === 'unsubscribeEvents') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        const subscriptionId = typeof params.subscriptionId === 'string' ? params.subscriptionId : null;
        if (!subscriptionId) {
            throw new Error("Missing required 'subscriptionId' for unsubscribeEvents.");
        }
        return handled(runtime.eventRuntime.unsubscribe(subscriptionId, { connectionId, sessionToken: req.sessionToken }));
    }

    if (req.method === 'pollEvents') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        const subscriptionId = typeof params.subscriptionId === 'string' ? params.subscriptionId : null;
        if (!subscriptionId) {
            throw new Error("Missing required 'subscriptionId' for pollEvents.");
        }
        return handled(runtime.eventRuntime.poll({
            subscriptionId,
            afterSequence: typeof params.afterSequence === 'number' ? params.afterSequence : undefined,
            limit: typeof params.limit === 'number' ? params.limit : undefined
        }, {
            connectionId,
            sessionToken: req.sessionToken
        }));
    }

    if (req.method === 'ackEvent') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        const subscriptionId = typeof params.subscriptionId === 'string' ? params.subscriptionId : null;
        if (!subscriptionId) {
            throw new Error("Missing required 'subscriptionId' for ackEvent.");
        }
        return handled(runtime.eventRuntime.ack({
            subscriptionId,
            eventId: typeof params.eventId === 'string' ? params.eventId : undefined,
            sequence: typeof params.sequence === 'number' ? params.sequence : undefined
        }, {
            connectionId,
            sessionToken: req.sessionToken
        }));
    }

    if (req.method === 'getBlackboardState') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        return handled(runtime.eventRuntime.getBlackboardState({
            contextId: typeof params.contextId === 'string' ? params.contextId : undefined,
            limit: typeof params.limit === 'number' ? params.limit : undefined
        }));
    }

    if (req.method === 'evaluateCompletion') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        return handled(runtime.eventRuntime.evaluateCompletion({
            contextId: typeof params.contextId === 'string' ? params.contextId : undefined,
            cooldownMs: typeof params.cooldownMs === 'number' ? params.cooldownMs : undefined,
            requiredGates: params.requiredGates
        }));
    }

    if (req.method === 'claimTask') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        const taskId = typeof params.taskId === 'string' ? params.taskId : null;
        if (!taskId) {
            throw new Error("Missing required 'taskId' for claimTask.");
        }
        return handled(runtime.eventRuntime.claimTask({
            taskId,
            contextId: resolveContextId(connectionId, params, sessionContextId) ?? undefined,
            leaseMs: typeof params.leaseMs === 'number' ? params.leaseMs : undefined
        }, {
            connectionId,
            sessionToken: req.sessionToken
        }));
    }

    if (req.method === 'releaseTask') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        const taskId = typeof params.taskId === 'string' ? params.taskId : null;
        if (!taskId) {
            throw new Error("Missing required 'taskId' for releaseTask.");
        }
        return handled(runtime.eventRuntime.releaseTask({ taskId }, { connectionId, sessionToken: req.sessionToken }));
    }

    if (req.method === 'resolveGate') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        const gateId = typeof params.gateId === 'string' ? params.gateId : null;
        if (!gateId) {
            throw new Error("Missing required 'gateId' for resolveGate.");
        }
        return handled(runtime.eventRuntime.resolveGate({
            gateId,
            contextId: resolveContextId(connectionId, params, sessionContextId) ?? undefined,
            severity: typeof params.severity === 'string' ? params.severity : undefined,
            status: params.status === 'open' ? 'open' : 'resolved',
            message: typeof params.message === 'string' ? params.message : undefined
        }, {
            connectionId,
            sessionToken: req.sessionToken
        }));
    }

    return NOT_HANDLED;
}
