import { randomUUID } from 'crypto';
import { evaluateCompletionState } from './events/completion';
import { getMutationEventType } from './events/mutations';
import {
    clampLimit,
    isOwner,
    normalizeLeaseMs,
    ownerKey,
    parseTypes,
    requireOwnedSubscription
} from './events/shared';
import {
    MAX_EVENTS_PER_CONTEXT,
    type AckParams,
    type BlackboardEvent,
    type BlackboardStateParams,
    type ClaimTaskParams,
    type CompletionEvaluation,
    type EvaluateCompletionParams,
    type EventSubscription,
    type OwnerIdentity,
    type PollParams,
    type QualityGate,
    type ReleaseTaskParams,
    type ResolveGateParams,
    type SubscribeParams,
    type TaskLease
} from './events/types';

export type {
    BlackboardEvent,
    EventSubscription,
    TaskLease,
    QualityGate,
    CompletionEvaluation
} from './events/types';

export class EventRuntime {
    private globalSequence = 0;
    private readonly eventStream: BlackboardEvent[] = [];
    private readonly eventsByContext = new Map<string, BlackboardEvent[]>();
    private readonly subscriptions = new Map<string, EventSubscription>();
    private readonly taskLeases = new Map<string, TaskLease>();
    private readonly gates = new Map<string, QualityGate>();

    emit(input: {
        type: string;
        contextId?: string | null;
        source: string;
        payload?: Record<string, unknown>;
    }): BlackboardEvent {
        const event: BlackboardEvent = {
            eventId: randomUUID(),
            sequence: ++this.globalSequence,
            contextId: input.contextId ?? null,
            type: input.type,
            timestamp: Date.now(),
            source: input.source,
            payload: input.payload ?? {}
        };

        this.eventStream.push(event);
        if (this.eventStream.length > MAX_EVENTS_PER_CONTEXT * 4) {
            this.eventStream.splice(0, this.eventStream.length - MAX_EVENTS_PER_CONTEXT * 4);
        }

        if (event.contextId) {
            const bucket = this.eventsByContext.get(event.contextId) ?? [];
            bucket.push(event);
            if (bucket.length > MAX_EVENTS_PER_CONTEXT) {
                bucket.splice(0, bucket.length - MAX_EVENTS_PER_CONTEXT);
            }
            this.eventsByContext.set(event.contextId, bucket);
        }

        return event;
    }

    subscribe(params: SubscribeParams, identity: OwnerIdentity): EventSubscription {
        const subscription: EventSubscription = {
            subscriptionId: randomUUID(),
            connectionId: identity.connectionId,
            sessionToken: identity.sessionToken ?? null,
            contextId: typeof params.contextId === 'string' && params.contextId.length > 0 ? params.contextId : null,
            types: parseTypes(params.types),
            createdAt: Date.now(),
            lastAckedSequence: typeof params.afterSequence === 'number' ? Math.max(0, Math.floor(params.afterSequence)) : 0
        };

        this.subscriptions.set(subscription.subscriptionId, subscription);
        return subscription;
    }

    listSubscriptions(identity: OwnerIdentity): EventSubscription[] {
        return [...this.subscriptions.values()]
            .filter(subscription => isOwner(subscription, identity))
            .sort((a, b) => a.createdAt - b.createdAt);
    }

    unsubscribe(subscriptionId: string, identity: OwnerIdentity): { removed: boolean } {
        const subscription = requireOwnedSubscription(this.subscriptions, subscriptionId, identity);
        this.subscriptions.delete(subscription.subscriptionId);
        return { removed: true };
    }

    poll(params: PollParams, identity: OwnerIdentity): {
        subscriptionId: string;
        cursor: number;
        events: BlackboardEvent[];
        hasMore: boolean;
    } {
        const subscription = requireOwnedSubscription(this.subscriptions, params.subscriptionId, identity);
        const limit = clampLimit(params.limit, 100);
        const cursor = typeof params.afterSequence === 'number'
            ? Math.max(0, Math.floor(params.afterSequence))
            : subscription.lastAckedSequence;

        const candidates = this.eventStream.filter(event => {
            if (event.sequence <= cursor) return false;
            if (subscription.contextId && event.contextId !== subscription.contextId) return false;
            if (subscription.types.length > 0 && !subscription.types.includes(event.type)) return false;
            return true;
        });

        const events = candidates.slice(0, limit);
        const lastSequence = events.length > 0 ? events[events.length - 1].sequence : cursor;
        const hasMore = candidates.length > events.length;

        return {
            subscriptionId: subscription.subscriptionId,
            cursor: lastSequence,
            events,
            hasMore
        };
    }

    ack(params: AckParams, identity: OwnerIdentity): { subscriptionId: string; lastAckedSequence: number } {
        const subscription = requireOwnedSubscription(this.subscriptions, params.subscriptionId, identity);
        let sequence = subscription.lastAckedSequence;

        if (typeof params.sequence === 'number' && Number.isFinite(params.sequence)) {
            sequence = Math.max(sequence, Math.floor(params.sequence));
        } else if (typeof params.eventId === 'string') {
            const event = this.eventStream.find(item => item.eventId === params.eventId);
            if (!event) {
                throw new Error(`Event '${params.eventId}' not found`);
            }
            sequence = Math.max(sequence, event.sequence);
        }

        subscription.lastAckedSequence = sequence;
        return { subscriptionId: subscription.subscriptionId, lastAckedSequence: sequence };
    }

    claimTask(params: ClaimTaskParams, identity: OwnerIdentity): {
        taskId: string;
        claimed: boolean;
        holder: string;
        expiresAt: number;
        contextId: string | null;
    } {
        const now = Date.now();
        const leaseMs = normalizeLeaseMs(params.leaseMs);
        const holder = ownerKey(identity);
        const existing = this.taskLeases.get(params.taskId);
        const contextId = typeof params.contextId === 'string' && params.contextId.length > 0
            ? params.contextId
            : existing?.contextId ?? null;

        if (existing && existing.expiresAt > now && existing.holder !== holder) {
            return {
                taskId: existing.taskId,
                claimed: false,
                holder: existing.holder,
                expiresAt: existing.expiresAt,
                contextId: existing.contextId
            };
        }

        const lease: TaskLease = existing
            ? {
                ...existing,
                holder,
                contextId,
                updatedAt: now,
                expiresAt: now + leaseMs
            }
            : {
                taskId: params.taskId,
                holder,
                contextId,
                createdAt: now,
                updatedAt: now,
                expiresAt: now + leaseMs
            };

        this.taskLeases.set(params.taskId, lease);
        this.emit({
            type: 'TaskClaimed',
            contextId: lease.contextId,
            source: `session:${holder}`,
            payload: { taskId: lease.taskId, holder: lease.holder, expiresAt: lease.expiresAt }
        });

        return {
            taskId: lease.taskId,
            claimed: true,
            holder: lease.holder,
            expiresAt: lease.expiresAt,
            contextId: lease.contextId
        };
    }

    releaseTask(params: ReleaseTaskParams, identity: OwnerIdentity): { taskId: string; released: boolean; reason?: string } {
        const lease = this.taskLeases.get(params.taskId);
        if (!lease) {
            return { taskId: params.taskId, released: false, reason: 'not_found' };
        }

        const holder = ownerKey(identity);
        const now = Date.now();
        if (lease.holder !== holder && lease.expiresAt > now) {
            return { taskId: params.taskId, released: false, reason: 'not_owner' };
        }

        this.taskLeases.delete(params.taskId);
        this.emit({
            type: 'TaskReleased',
            contextId: lease.contextId,
            source: `session:${holder}`,
            payload: { taskId: lease.taskId }
        });
        return { taskId: params.taskId, released: true };
    }

    resolveGate(params: ResolveGateParams, identity: OwnerIdentity): QualityGate {
        const now = Date.now();
        const owner = ownerKey(identity);
        const existing = this.gates.get(params.gateId);
        const status: 'open' | 'resolved' = params.status === 'open' ? 'open' : 'resolved';
        const contextId = typeof params.contextId === 'string' && params.contextId.length > 0
            ? params.contextId
            : existing?.contextId ?? null;

        const gate: QualityGate = existing
            ? {
                ...existing,
                contextId,
                severity: params.severity ?? existing.severity,
                status,
                message: params.message ?? existing.message,
                updatedBy: owner,
                updatedAt: now,
                resolvedAt: status === 'resolved' ? now : null
            }
            : {
                gateId: params.gateId,
                contextId,
                severity: params.severity ?? null,
                status,
                message: params.message ?? null,
                updatedBy: owner,
                createdAt: now,
                updatedAt: now,
                resolvedAt: status === 'resolved' ? now : null
            };

        this.gates.set(gate.gateId, gate);
        this.emit({
            type: gate.status === 'resolved' ? 'GateCleared' : 'GateRaised',
            contextId: gate.contextId,
            source: `session:${owner}`,
            payload: {
                gateId: gate.gateId,
                status: gate.status,
                severity: gate.severity,
                message: gate.message
            }
        });
        return gate;
    }

    getBlackboardState(params: BlackboardStateParams = {}): {
        globalSequence: number;
        subscriptions: number;
        leases: TaskLease[];
        gates: QualityGate[];
        recentEvents: BlackboardEvent[];
    } {
        const contextId = typeof params.contextId === 'string' && params.contextId.length > 0 ? params.contextId : null;
        const limit = clampLimit(params.limit, 50);
        const events = contextId
            ? [...(this.eventsByContext.get(contextId) ?? [])]
            : [...this.eventStream];

        return {
            globalSequence: this.globalSequence,
            subscriptions: this.subscriptions.size,
            leases: [...this.taskLeases.values()].sort((a, b) => b.updatedAt - a.updatedAt),
            gates: [...this.gates.values()].sort((a, b) => b.updatedAt - a.updatedAt),
            recentEvents: events.slice(-limit)
        };
    }

    evaluateCompletion(params: EvaluateCompletionParams = {}): CompletionEvaluation {
        return evaluateCompletionState(
            params,
            this.eventStream,
            this.taskLeases.values(),
            this.gates.values()
        );
    }

    emitMutation(params: {
        method: string;
        contextId: string | null;
        source: string;
        payload: Record<string, unknown>;
    }): BlackboardEvent {
        return this.emit({
            type: getMutationEventType(params.method),
            contextId: params.contextId,
            source: params.source,
            payload: {
                method: params.method,
                ...params.payload
            }
        });
    }
}
