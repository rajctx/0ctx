const BLOCKING_EVENT_TYPE_NAMES = ['GateRaised', 'TaskClaimed'] as const;

export const MAX_EVENTS_PER_CONTEXT = 2000;
export const MAX_EVENT_RESULTS = 500;
export const MIN_LEASE_MS = 1_000;
export const MAX_LEASE_MS = 60 * 60 * 1_000;
export const DEFAULT_LEASE_MS = 60_000;
export const DEFAULT_STABILIZATION_COOLDOWN_MS = 30_000;
export const MAX_STABILIZATION_COOLDOWN_MS = 5 * 60 * 1_000;
export const DEFAULT_REQUIRED_GATES = ['typecheck', 'test', 'lint', 'security'];
export const BLOCKING_EVENT_TYPES = new Set<string>(BLOCKING_EVENT_TYPE_NAMES);

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

export interface OwnerIdentity {
    connectionId: string;
    sessionToken?: string;
}

export interface SubscribeParams {
    contextId?: string;
    types?: unknown;
    afterSequence?: number;
}

export interface PollParams {
    subscriptionId: string;
    afterSequence?: number;
    limit?: number;
}

export interface AckParams {
    subscriptionId: string;
    eventId?: string;
    sequence?: number;
}

export interface ClaimTaskParams {
    taskId: string;
    contextId?: string;
    leaseMs?: number;
}

export interface ReleaseTaskParams {
    taskId: string;
}

export interface ResolveGateParams {
    gateId: string;
    contextId?: string;
    severity?: string;
    status?: 'open' | 'resolved';
    message?: string;
}

export interface BlackboardStateParams {
    contextId?: string;
    limit?: number;
}

export interface EvaluateCompletionParams {
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
