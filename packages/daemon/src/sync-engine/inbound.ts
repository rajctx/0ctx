import type Database from 'better-sqlite3';
import type { Graph, SyncEnvelope } from '@0ctx/core';
import { log } from '../logger';
import { decodeFullSyncDump, replaceContextFromDump } from './context-dump';
import { buildMergeDelta, summarizeContextDump } from './merge-delta';
import {
    getLastRemoteTimestamp,
    getLatestLocalMutationAt,
    setLastRemoteTimestamp
} from './merge-state';

export function mergeRemoteEnvelope(
    graph: Graph,
    db: Database.Database,
    envelope: SyncEnvelope
): void {
    try {
        if (envelope.syncPolicy !== 'full_sync') {
            log('debug', 'sync_pull_skip_policy', {
                contextId: envelope.contextId,
                policy: envelope.syncPolicy
            });
            return;
        }

        const remoteTimestamp = Number.isFinite(envelope.timestamp)
            ? Math.max(0, Math.floor(envelope.timestamp))
            : Date.now();
        const lastRemoteTimestamp = getLastRemoteTimestamp(db, envelope.contextId);
        if (remoteTimestamp <= lastRemoteTimestamp) {
            log('debug', 'sync_pull_skip_stale', {
                contextId: envelope.contextId,
                envelopeTimestamp: remoteTimestamp,
                lastRemoteTimestamp
            });
            return;
        }

        const dump = decodeFullSyncDump(envelope);
        if (!dump) return;

        const existingContext = graph.getContext(envelope.contextId);
        const beforeDump = existingContext ? graph.exportContextDump(envelope.contextId) : null;
        const latestLocalMutationAt = existingContext
            ? getLatestLocalMutationAt(db, envelope.contextId)
            : 0;

        if (existingContext && latestLocalMutationAt > remoteTimestamp) {
            recordKeptLocalMerge(graph, envelope, remoteTimestamp, latestLocalMutationAt, beforeDump, dump);
            setLastRemoteTimestamp(db, envelope.contextId, remoteTimestamp);
            log('warn', 'sync_pull_conflict_local_newer', {
                contextId: envelope.contextId,
                envelopeTimestamp: remoteTimestamp,
                latestLocalMutationAt
            });
            return;
        }

        replaceContextFromDump(graph, db, envelope.contextId, dump);
        const afterDump = graph.exportContextDump(envelope.contextId);
        const mergeDelta = buildMergeDelta(beforeDump, afterDump);
        setLastRemoteTimestamp(db, envelope.contextId, remoteTimestamp);

        graph.recordAuditEvent({
            action: 'sync_merge',
            contextId: envelope.contextId,
            payload: {
                decision: existingContext ? 'remote_overwrite' : 'remote_create',
                envelope: {
                    timestamp: remoteTimestamp,
                    tenantId: envelope.tenantId,
                    userId: envelope.userId
                },
                local: {
                    latestMutationAt: latestLocalMutationAt || null
                },
                before: mergeDelta.before,
                after: mergeDelta.after,
                changes: mergeDelta.changes
            },
            result: {
                applied: true
            },
            metadata: {
                actor: envelope.userId || null,
                source: 'sync_pull'
            }
        });

        log('info', 'sync_pull_merged', {
            contextId: envelope.contextId,
            name: dump.context.name,
            envelopeTimestamp: remoteTimestamp,
            decision: existingContext ? 'remote_overwrite' : 'remote_create',
            nodeCount: dump.nodes.length
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log('warn', 'sync_pull_merge_error', { contextId: envelope.contextId, error: message });
    }
}

function recordKeptLocalMerge(
    graph: Graph,
    envelope: SyncEnvelope,
    remoteTimestamp: number,
    latestLocalMutationAt: number,
    beforeDump: ReturnType<Graph['exportContextDump']> | null,
    incomingDump: ReturnType<Graph['exportContextDump']>
): void {
    graph.recordAuditEvent({
        action: 'sync_merge',
        contextId: envelope.contextId,
        payload: {
            decision: 'kept_local',
            reason: 'local_newer_than_remote',
            envelope: {
                timestamp: remoteTimestamp,
                tenantId: envelope.tenantId,
                userId: envelope.userId
            },
            local: {
                latestMutationAt: latestLocalMutationAt
            },
            before: beforeDump ? summarizeContextDump(beforeDump) : null,
            incoming: summarizeContextDump(incomingDump)
        },
        result: {
            applied: false
        },
        metadata: {
            actor: envelope.userId || null,
            source: 'sync_pull'
        }
    });
}
