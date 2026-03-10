import type { ConnectorState } from '../connector.js';
import type { ConnectorEventPayload } from '../cloud.js';
import { redactEventForMetadataOnly } from './helpers.js';
import type { ConnectorRuntimeDependencies } from './types.js';

export async function syncEventBridge(params: {
    deps: ConnectorRuntimeDependencies;
    registration: ConnectorState;
    accessToken: string;
    daemonSessionToken: string | null;
    lastError: string | null;
}): Promise<{ daemonSessionToken: string | null; lastError: string | null }> {
    const { deps, registration, accessToken } = params;
    let { daemonSessionToken, lastError } = params;

    try {
        if (!daemonSessionToken) {
            throw new Error('daemon_session_unavailable');
        }

        if (!registration.runtime.eventSubscriptionId) {
            const subscription = await deps.subscribeEvents(daemonSessionToken, registration.runtime.lastEventSequence);
            registration.runtime.eventSubscriptionId = subscription.subscriptionId;
            if (typeof subscription.lastAckedSequence === 'number') {
                registration.runtime.lastEventSequence = subscription.lastAckedSequence;
            }
        }

        const subscriptionId = registration.runtime.eventSubscriptionId;
        if (!subscriptionId) {
            throw new Error('event_subscription_unavailable');
        }

        const polled = await deps.pollEvents(daemonSessionToken, subscriptionId, registration.runtime.lastEventSequence, 200);
        if (polled.events.length > 0) {
            const policyCache = new Map<string, 'local_only' | 'metadata_only' | 'full_sync' | null>();
            const filteredEvents: ConnectorEventPayload[] = [];

            for (const event of polled.events) {
                if (!event.contextId) {
                    filteredEvents.push(event);
                    continue;
                }
                if (!policyCache.has(event.contextId)) {
                    policyCache.set(event.contextId, await deps.getContextSyncPolicy(daemonSessionToken, event.contextId));
                }
                const policy = policyCache.get(event.contextId) ?? 'metadata_only';
                if (policy === 'local_only') continue;
                filteredEvents.push(policy === 'metadata_only' ? redactEventForMetadataOnly(event) : event);
            }

            if (filteredEvents.length > 0) {
                deps.enqueueEvents(subscriptionId, filteredEvents, deps.now());
            }

            const ackSequence = polled.cursor;
            if (typeof ackSequence === 'number' && ackSequence > registration.runtime.lastEventSequence) {
                await deps.ackEvents(daemonSessionToken, subscriptionId, ackSequence);
                registration.runtime.lastEventSequence = ackSequence;
            }
        }

        const readyEvents = deps.getReadyEvents(200, deps.now());
        if (readyEvents.length === 0) {
            registration.runtime.eventBridgeError = null;
            return { daemonSessionToken, lastError };
        }

        const policyCache = new Map<string, 'local_only' | 'metadata_only' | 'full_sync' | null>();
        const queueIdsToDrop: string[] = [];
        const sendable: Array<{ queueId: string; subscriptionId: string; event: ConnectorEventPayload }> = [];

        for (const item of readyEvents) {
            if (!item.contextId) {
                sendable.push({
                    queueId: item.queueId,
                    subscriptionId: item.subscriptionId,
                    event: {
                        eventId: item.eventId,
                        sequence: item.sequence,
                        contextId: item.contextId,
                        type: item.type,
                        timestamp: item.timestamp,
                        source: item.source,
                        payload: item.payload
                    }
                });
                continue;
            }

            if (!policyCache.has(item.contextId)) {
                policyCache.set(item.contextId, await deps.getContextSyncPolicy(daemonSessionToken, item.contextId));
            }
            const policy = policyCache.get(item.contextId) ?? 'metadata_only';
            if (policy === 'local_only') {
                queueIdsToDrop.push(item.queueId);
                continue;
            }

            const rawEvent: ConnectorEventPayload = {
                eventId: item.eventId,
                sequence: item.sequence,
                contextId: item.contextId,
                type: item.type,
                timestamp: item.timestamp,
                source: item.source,
                payload: item.payload
            };
            sendable.push({
                queueId: item.queueId,
                subscriptionId: item.subscriptionId,
                event: policy === 'metadata_only' ? redactEventForMetadataOnly(rawEvent) : rawEvent
            });
        }

        if (queueIdsToDrop.length > 0) {
            deps.markEventsDelivered(queueIdsToDrop);
        }

        if (sendable.length === 0) {
            registration.runtime.eventBridgeError = null;
            return { daemonSessionToken, lastError };
        }

        const cursor = sendable.reduce((max, item) => Math.max(max, item.event.sequence), 0);
        const ingestResult = await deps.sendConnectorEvents(accessToken, {
            machineId: registration.machineId,
            tenantId: registration.tenantId,
            subscriptionId: sendable[0].subscriptionId,
            cursor,
            events: sendable.map(item => item.event)
        });

        const queueIds = sendable.map(item => item.queueId);
        if (ingestResult.ok) {
            deps.markEventsDelivered(queueIds);
            registration.runtime.lastEventSyncAt = deps.now();
            registration.runtime.eventBridgeError = null;
        } else if (ingestResult.statusCode === 404) {
            registration.runtime.eventBridgeSupported = false;
            registration.runtime.eventBridgeError = null;
            deps.markEventsFailed(queueIds, 'event_ingest_unavailable', deps.now());
        } else {
            const errorText = ingestResult.error ?? 'event_ingest_failed';
            deps.markEventsFailed(queueIds, errorText, deps.now());
            registration.runtime.eventBridgeError = errorText;
            lastError = errorText;
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        registration.runtime.eventBridgeError = message;
        if (message.includes('Invalid sessionToken')) {
            registration.runtime.daemonSessionToken = null;
            registration.runtime.eventSubscriptionId = null;
            daemonSessionToken = null;
        } else if (message.includes('not found')) {
            registration.runtime.eventSubscriptionId = null;
        }
        lastError = message;
    }

    return { daemonSessionToken, lastError };
}
