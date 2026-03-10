import type { Graph } from '@0ctx/core';
import { encryptJson } from '@0ctx/core';
import { summarizeContextDump } from './merge-delta';
import { buildFullSyncPayload, buildMetadataOnlyPayload } from './payloads';
import type { EnvelopeBuildResult } from './types';

export function buildEnvelope(
    graph: Graph,
    contextId: string,
    tenantId: string,
    userId: string
): EnvelopeBuildResult {
    const policy = graph.getContextSyncPolicy(contextId);
    if (!policy) {
        return { kind: 'missing', reason: 'Context not found' };
    }

    if (policy === 'local_only') {
        return { kind: 'skip', reason: 'sync policy local_only' };
    }

    try {
        const dump = graph.exportContextDump(contextId);
        const payload = policy === 'full_sync'
            ? buildFullSyncPayload(dump)
            : buildMetadataOnlyPayload(dump);
        const summary = summarizeContextDump(dump);

        return {
            kind: 'send',
            summary,
            envelope: {
                version: 1,
                contextId,
                tenantId,
                userId,
                timestamp: Date.now(),
                encrypted: true,
                syncPolicy: policy,
                payload: encryptJson(payload)
            }
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { kind: 'missing', reason: message };
    }
}

export function recordUploadAudit(
    graph: Graph,
    queueEntryId: string,
    contextId: string,
    userId: string,
    built: Extract<EnvelopeBuildResult, { kind: 'send' }>
): void {
    graph.recordAuditEvent({
        action: 'sync_upload',
        contextId,
        payload: {
            queueEntryId,
            syncPolicy: built.envelope.syncPolicy,
            envelope: {
                version: built.envelope.version,
                timestamp: built.envelope.timestamp,
                encrypted: built.envelope.encrypted
            },
            context: built.summary
        },
        result: {
            uploaded: true
        },
        metadata: {
            actor: userId || null,
            source: 'sync_push'
        }
    });
}
