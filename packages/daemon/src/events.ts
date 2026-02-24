import { randomUUID } from 'crypto';

const MAX_EVENTS_PER_CONTEXT = 2000;
const MAX_EVENT_RESULTS = 500;
const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 60 * 60 * 1_000;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_STABILIZATION_COOLDOWN_MS = 30_000;
const MAX_STABILIZATION_COOLDOWN_MS = 5 * 60 * 1_000;
const DEFAULT_REQUIRED_GATES = ['typecheck', 'test', 'lint', 'security'];
const BLOCKING_EVENT_TYPES = new Set(['GateRaised', 'TaskClaimed']);

export interface BlackboardEvent {
    eventId: string;
    sequence: number;
    contextId: string | null;
    type: string;
    timestamp: number;
    source: string;
    payload: Record<string, unknown>;
}

export interface EventSubscription {
    subscriptionId: string;
    connectionId: string;
    sessionToken: string | null;
    contextId: string | null;
    types: string[];
    createdAt: number;
    lastAckedSequence: number;
}

export interface TaskLease {
    taskId: string;
    holder: string;
    contextId: string | null;
    createdAt: number;
    updatedAt: number;
    expiresAt: number;
}

export interface QualityGate {
    gateId: string;
    contextId: string | null;
    severity: string | null;
    status: 'open' | 'resolved';
    message: string | null;
    updatedBy: string;
    createdAt: number;
    updatedAt: number;
    resolvedAt: number | null;
}

interface OwnerIdentity {
    connectionId: string;
    sessionToken?: string;
}

interface SubscribeParams {
    contextId?: string;
    types?: unknown;
    afterSequence?: number;
}

interface PollParams {
    subscriptionId: string;
    afterSequence?: number;
    limit?: number;
}

interface AckParams {
    subscriptionId: string;
    eventId?: string;
    sequence?: number;
}

interface ClaimTaskParams {
    taskId: string;
    contextId?: string;
    leaseMs?: number;
}

interface ReleaseTaskParams {
    taskId: string;
}

interface ResolveGateParams {
    gateId: string;
    contextId?: string;
    severity?: string;
    status?: 'open' | 'resolved';
    message?: string;
}

interface BlackboardStateParams {
    contextId?: string;
    limit?: number;
}

interface EvaluateCompletionParams {
    contextId?: string;
    cooldownMs?: number;
    requiredGates?: unknown;
}

export interface CompletionEvaluation {
    contextId: string | null;
    complete: boolean;
    evaluatedAt: number;
    stabilizationCooldownMs: number;
    stabilizationWindowStartedAt: number;
    openGates: Array<{ gateId: string; severity: string | null; message: string | null }>;
    unresolvedRequiredGates: string[];
    activeLeases: Array<{ taskId: string; holder: string; expiresAt: number }>;
    recentBlockingEvents: Array<{ eventId: string; type: string; sequence: number; timestamp: number }>;
    reasons: string[];
}

function ownerKey(identity: OwnerIdentity): string {
    return identity.sessionToken ?? identity.connectionId;
}

function parseTypes(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.filter((item): item is string => typeof item === 'string' && item.length > 0))];
}

function clampLimit(limit: number | undefined, fallback: number): number {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) return fallback;
    return Math.max(1, Math.min(MAX_EVENT_RESULTS, Math.floor(limit)));
}

function normalizeLeaseMs(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LEASE_MS;
    return Math.max(MIN_LEASE_MS, Math.min(MAX_LEASE_MS, Math.floor(value)));
}

function normalizeCooldownMs(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_STABILIZATION_COOLDOWN_MS;
    return Math.max(0, Math.min(MAX_STABILIZATION_COOLDOWN_MS, Math.floor(value)));
}

function parseRequiredGates(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [...DEFAULT_REQUIRED_GATES];
    const parsed = raw
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(item => item.length > 0);
    return parsed.length > 0 ? [...new Set(parsed)] : [...DEFAULT_REQUIRED_GATES];
}

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
            .filter(subscription => this.isOwner(subscription, identity))
            .sort((a, b) => a.createdAt - b.createdAt);
    }

    unsubscribe(subscriptionId: string, identity: OwnerIdentity): { removed: boolean } {
        const subscription = this.requireOwnedSubscription(subscriptionId, identity);
        this.subscriptions.delete(subscription.subscriptionId);
        return { removed: true };
    }

    poll(params: PollParams, identity: OwnerIdentity): {
        subscriptionId: string;
        cursor: number;
        events: BlackboardEvent[];
        hasMore: boolean;
    } {
        const subscription = this.requireOwnedSubscription(params.subscriptionId, identity);
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
        const subscription = this.requireOwnedSubscription(params.subscriptionId, identity);
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
        const now = Date.now();
        const contextId = typeof params.contextId === 'string' && params.contextId.length > 0 ? params.contextId : null;
        const cooldownMs = normalizeCooldownMs(params.cooldownMs);
        const stabilizationWindowStartedAt = now - cooldownMs;
        const requiredGates = parseRequiredGates(params.requiredGates);

        const gates = [...this.gates.values()].filter(gate => !contextId || gate.contextId === contextId);
        const openGates = gates
            .filter(gate => gate.status === 'open')
            .map(gate => ({
                gateId: gate.gateId,
                severity: gate.severity,
                message: gate.message
            }));

        const unresolvedRequiredGates = requiredGates.filter((gateId) => {
            const gate = gates.find(item => item.gateId === gateId);
            return !gate || gate.status !== 'resolved';
        });

        const activeLeases = [...this.taskLeases.values()]
            .filter(lease => (!contextId || lease.contextId === contextId) && lease.expiresAt > now)
            .map(lease => ({
                taskId: lease.taskId,
                holder: lease.holder,
                expiresAt: lease.expiresAt
            }));

        const recentBlockingEvents = this.eventStream
            .filter(event =>
                (!contextId || event.contextId === contextId)
                && event.timestamp >= stabilizationWindowStartedAt
                && BLOCKING_EVENT_TYPES.has(event.type)
            )
            .slice(-100)
            .map(event => ({
                eventId: event.eventId,
                type: event.type,
                sequence: event.sequence,
                timestamp: event.timestamp
            }));

        const reasons: string[] = [];
        if (openGates.length > 0) reasons.push('open_gates');
        if (unresolvedRequiredGates.length > 0) reasons.push('required_gates_unresolved');
        if (activeLeases.length > 0) reasons.push('active_leases');
        if (recentBlockingEvents.length > 0) reasons.push('stabilization_window_active');

        return {
            contextId,
            complete: reasons.length === 0,
            evaluatedAt: now,
            stabilizationCooldownMs: cooldownMs,
            stabilizationWindowStartedAt,
            openGates,
            unresolvedRequiredGates,
            activeLeases,
            recentBlockingEvents,
            reasons
        };
    }

    emitMutation(params: {
        method: string;
        contextId: string | null;
        source: string;
        payload: Record<string, unknown>;
    }): BlackboardEvent {
        const methodToType: Record<string, string> = {
            createContext: 'ContextCreated',
            deleteContext: 'ContextDeleted',
            switchContext: 'ContextSwitched',
            addNode: 'NodeAdded',
            updateNode: 'NodeUpdated',
            deleteNode: 'NodeDeleted',
            addEdge: 'EdgeAdded',
            saveCheckpoint: 'CheckpointSaved',
            rewind: 'CheckpointRewound',
            createBackup: 'BackupCreated',
            restoreBackup: 'BackupRestored'
        };

        const type = methodToType[params.method] ?? 'Mutation';
        return this.emit({
            type,
            contextId: params.contextId,
            source: params.source,
            payload: {
                method: params.method,
                ...params.payload
            }
        });
    }

    private isOwner(subscription: EventSubscription, identity: OwnerIdentity): boolean {
        if (identity.sessionToken) {
            return subscription.sessionToken === identity.sessionToken;
        }
        return subscription.connectionId === identity.connectionId;
    }

    private requireOwnedSubscription(subscriptionId: string, identity: OwnerIdentity): EventSubscription {
        const subscription = this.subscriptions.get(subscriptionId);
        if (!subscription) {
            throw new Error(`Subscription '${subscriptionId}' not found`);
        }
        if (!this.isOwner(subscription, identity)) {
            throw new Error(`Subscription '${subscriptionId}' is not owned by this session`);
        }
        return subscription;
    }
}
