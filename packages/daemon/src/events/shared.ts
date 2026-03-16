import {
    DEFAULT_LEASE_MS,
    DEFAULT_REQUIRED_GATES,
    DEFAULT_STABILIZATION_COOLDOWN_MS,
    MAX_EVENT_RESULTS,
    MAX_LEASE_MS,
    MAX_STABILIZATION_COOLDOWN_MS,
    MIN_LEASE_MS
} from './types';
import type { EventSubscription, OwnerIdentity } from './types';

export function ownerKey(identity: OwnerIdentity): string {
    return identity.sessionToken ?? identity.connectionId;
}

export function parseTypes(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.filter((item): item is string => typeof item === 'string' && item.length > 0))];
}

export function clampLimit(limit: number | undefined, fallback: number): number {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) return fallback;
    return Math.max(1, Math.min(MAX_EVENT_RESULTS, Math.floor(limit)));
}

export function normalizeLeaseMs(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LEASE_MS;
    return Math.max(MIN_LEASE_MS, Math.min(MAX_LEASE_MS, Math.floor(value)));
}

export function normalizeCooldownMs(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_STABILIZATION_COOLDOWN_MS;
    return Math.max(0, Math.min(MAX_STABILIZATION_COOLDOWN_MS, Math.floor(value)));
}

export function parseRequiredGates(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [...DEFAULT_REQUIRED_GATES];
    const parsed = raw
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    return parsed.length > 0 ? [...new Set(parsed)] : [...DEFAULT_REQUIRED_GATES];
}

export function isOwner(subscription: EventSubscription, identity: OwnerIdentity): boolean {
    if (identity.sessionToken) {
        return subscription.sessionToken === identity.sessionToken;
    }
    return subscription.connectionId === identity.connectionId;
}

export function requireOwnedSubscription(
    subscriptions: Map<string, EventSubscription>,
    subscriptionId: string,
    identity: OwnerIdentity
): EventSubscription {
    const subscription = subscriptions.get(subscriptionId);
    if (!subscription) {
        throw new Error(`Subscription '${subscriptionId}' not found`);
    }
    if (!isOwner(subscription, identity)) {
        throw new Error(`Subscription '${subscriptionId}' is not owned by this session`);
    }
    return subscription;
}
