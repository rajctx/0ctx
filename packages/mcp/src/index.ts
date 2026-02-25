import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { tools } from './tools';
import { sendToDaemon } from './client';

const server = new Server(
    { name: '0ctx', version: '0.1.0' },
    { capabilities: { tools: {} } }
);

import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

let sessionToken: string | null = null;
let activeContextId: string | null = null;

async function ensureSession(): Promise<string> {
    if (sessionToken) return sessionToken;

    const session = await sendToDaemon('createSession', {});
    if (typeof session.sessionToken !== 'string' || session.sessionToken.length === 0) {
        throw new Error('Daemon returned an invalid session token.');
    }

    sessionToken = session.sessionToken;
    activeContextId = session.contextId ?? null;
    return session.sessionToken;
}

function pickContextId(args: Record<string, unknown> | undefined): string | undefined {
    if (typeof args?.contextId === 'string' && args.contextId.length > 0) {
        return args.contextId;
    }
    return activeContextId ?? undefined;
}

async function callDaemon(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const token = await ensureSession();
    return sendToDaemon(method, params, { sessionToken: token });
}

server.setRequestHandler(CallToolRequestSchema, async (req: any) => {
    const { name, arguments: rawArgs } = req.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;

    try {
        switch (name) {
            case 'ctx_list_contexts': {
                const contexts = await callDaemon('listContexts', {});
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(contexts, null, 2) }] } };
            }
            case 'ctx_create_context': {
                const ctx = await callDaemon('createContext', { name: args.name, paths: args.paths });
                activeContextId = ctx.id;
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: `Created and switched to context: ${ctx.id} (${ctx.name})` }] } };
            }
            case 'ctx_switch_context': {
                const ctx = await callDaemon('switchContext', { contextId: args.contextId });
                activeContextId = ctx.id;
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: `Switched to active context: ${ctx.name}` }] } };
            }
            case 'ctx_set': {
                const contextId = pickContextId(args);
                const node = await callDaemon('addNode', { ...args, contextId, source: '0ctx-mcp' });
                if (args.relatesTo && args.relation) {
                    await callDaemon('addEdge', { fromId: node.id, toId: args.relatesTo as string, relation: args.relation as string });
                }
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: `Saved: ${node.id}` }] } };
            }
            case 'ctx_get': {
                const contextId = pickContextId(args);
                const node = await callDaemon('getByKey', { contextId, key: args.key });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: node ? JSON.stringify(node, null, 2) : 'Not found' }] } };
            }
            case 'ctx_query': {
                const subgraph = await callDaemon('getSubgraph', { rootId: args.nodeId, depth: args.depth ?? 2, maxNodes: args.maxNodes ?? 20 });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(subgraph, null, 2) }] } };
            }
            case 'ctx_search': {
                const contextId = pickContextId(args);
                const results = await callDaemon('search', { contextId, query: args.query, limit: args.limit ?? 10 });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] } };
            }
            case 'ctx_supersede': {
                await callDaemon('addEdge', { fromId: args.newNodeId, toId: args.oldNodeId, relation: 'supersedes' });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: `Node ${args.oldNodeId} successfully superseded.` }] } };
            }
            case 'ctx_checkpoint': {
                const contextId = pickContextId(args);
                const cp = await callDaemon('saveCheckpoint', { contextId, name: args.name });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: `Checkpoint saved: ${cp.id}` }] } };
            }
            case 'ctx_rewind': {
                await callDaemon('rewind', { checkpointId: args.checkpointId });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: 'Rewound to checkpoint.' }] } };
            }
            case 'ctx_health': {
                const health = await callDaemon('health', {});
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(health, null, 2) }] } };
            }
            case 'ctx_metrics': {
                const metrics = await callDaemon('metricsSnapshot', {});
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(metrics, null, 2) }] } };
            }
            case 'ctx_sync_policy_get': {
                const contextId = pickContextId(args);
                const policy = await callDaemon('getSyncPolicy', { contextId });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(policy, null, 2) }] } };
            }
            case 'ctx_sync_policy_set': {
                const contextId = pickContextId(args);
                const policy = await callDaemon('setSyncPolicy', {
                    contextId,
                    syncPolicy: args.syncPolicy
                });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(policy, null, 2) }] } };
            }
            case 'ctx_audit_recent': {
                const contextId = pickContextId(args);
                const events = await callDaemon('listAuditEvents', {
                    contextId,
                    limit: args.limit ?? 25
                });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(events, null, 2) }] } };
            }
            case 'ctx_backup_create': {
                const contextId = pickContextId(args);
                const backup = await callDaemon('createBackup', {
                    contextId,
                    name: args.name,
                    encrypted: args.encrypted ?? true
                });
                return {
                    _meta: {},
                    toolResult: {
                        content: [{ type: 'text', text: `Backup created: ${backup.fileName}` }]
                    }
                };
            }
            case 'ctx_backup_list': {
                const backups = await callDaemon('listBackups', {});
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(backups, null, 2) }] } };
            }
            case 'ctx_backup_restore': {
                const restored = await callDaemon('restoreBackup', {
                    fileName: args.fileName,
                    name: args.name
                });
                activeContextId = restored.id;
                return {
                    _meta: {},
                    toolResult: {
                        content: [{ type: 'text', text: `Restored to context: ${restored.id} (${restored.name})` }]
                    }
                };
            }
            case 'ctx_runtime_status': {
                const health = await callDaemon('health', {}) as {
                    auth?: { authenticated?: boolean; tokenExpired?: boolean; email?: string; tenantId?: string };
                    sync?: {
                        enabled?: boolean; running?: boolean; lastPushAt?: number | null; lastPullAt?: number | null; lastError?: string | null;
                        queue?: { pending?: number; inFlight?: number; failed?: number; done?: number }
                    } | null;
                };

                const auth = health.auth ?? {};
                const sync = health.sync ?? {};

                // Compute runtime posture
                let posture: 'connected' | 'degraded' | 'offline' = 'offline';
                if (auth.authenticated && !auth.tokenExpired) {
                    posture = (sync.enabled && sync.running) ? 'connected' : 'degraded';
                } else if (auth.authenticated && auth.tokenExpired) {
                    posture = 'degraded';
                }

                const capabilities = [
                    'graph', 'search', 'checkpoints', 'audit', 'backups',
                    ...(auth.authenticated ? ['auth'] : []),
                    ...(sync.enabled ? ['sync'] : []),
                ];

                const status = {
                    posture,
                    capabilities,
                    auth: {
                        authenticated: auth.authenticated ?? false,
                        email: auth.email ?? null,
                        tenantId: auth.tenantId ?? null,
                        tokenExpired: auth.tokenExpired ?? false,
                    },
                    sync: {
                        enabled: sync.enabled ?? false,
                        running: sync.running ?? false,
                        lastPushAt: sync.lastPushAt ?? null,
                        lastPullAt: sync.lastPullAt ?? null,
                        lastError: sync.lastError ?? null,
                        queue: sync.queue ?? { pending: 0, inFlight: 0, failed: 0, done: 0 },
                    },
                };

                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] } };
            }
            case 'ctx_blackboard_subscribe': {
                const contextId = pickContextId(args);
                const subscription = await callDaemon('subscribeEvents', {
                    contextId,
                    types: args.types,
                    afterSequence: args.afterSequence
                });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(subscription, null, 2) }] } };
            }
            case 'ctx_blackboard_poll': {
                const result = await callDaemon('pollEvents', {
                    subscriptionId: args.subscriptionId,
                    afterSequence: args.afterSequence,
                    limit: args.limit
                });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } };
            }
            case 'ctx_blackboard_ack': {
                const result = await callDaemon('ackEvent', {
                    subscriptionId: args.subscriptionId,
                    eventId: args.eventId,
                    sequence: args.sequence
                });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } };
            }
            case 'ctx_blackboard_state': {
                const contextId = pickContextId(args);
                const state = await callDaemon('getBlackboardState', {
                    contextId,
                    limit: args.limit
                });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(state, null, 2) }] } };
            }
            case 'ctx_blackboard_completion': {
                const contextId = pickContextId(args);
                const completion = await callDaemon('evaluateCompletion', {
                    contextId,
                    cooldownMs: args.cooldownMs,
                    requiredGates: args.requiredGates
                });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(completion, null, 2) }] } };
            }
            case 'ctx_task_claim': {
                const contextId = pickContextId(args);
                const claim = await callDaemon('claimTask', {
                    taskId: args.taskId,
                    contextId,
                    leaseMs: args.leaseMs
                });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(claim, null, 2) }] } };
            }
            case 'ctx_task_release': {
                const released = await callDaemon('releaseTask', {
                    taskId: args.taskId
                });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(released, null, 2) }] } };
            }
            case 'ctx_gate_resolve': {
                const contextId = pickContextId(args);
                const gate = await callDaemon('resolveGate', {
                    gateId: args.gateId,
                    contextId,
                    severity: args.severity,
                    status: args.status,
                    message: args.message
                });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(gate, null, 2) }] } };
            }
            case 'ctx_auth_status': {
                const authStatus = await callDaemon('auth/status', {});
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(authStatus, null, 2) }] } };
            }
            case 'ctx_sync_status': {
                const syncStatus = await callDaemon('syncStatus', {});
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(syncStatus, null, 2) }] } };
            }
            case 'ctx_sync_now': {
                const syncResult = await callDaemon('syncNow', {});
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(syncResult, null, 2) }] } };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (e: any) {
        return { _meta: {}, toolResult: { content: [{ type: 'text', text: `Error: ${e.message}. Ensure you have an active context.` }], isError: true } };
    }
});

const transport = new StdioServerTransport();
server.connect(transport);
