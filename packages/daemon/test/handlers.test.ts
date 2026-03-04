import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Graph, openDb } from '@0ctx/core';
import { handleRequest } from '../src/handlers';
import { EventRuntime } from '../src/events';
import { resetResolverStateForTests } from '../src/resolver';
import type { HandlerRuntimeContext } from '../src/handlers';

const tempDirs: string[] = [];

function createGraph() {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-daemon-handlers-'));
    tempDirs.push(tempDir);
    const db = openDb({ dbPath: path.join(tempDir, '0ctx.db') });
    return { db, graph: new Graph(db) };
}

function runtime(): HandlerRuntimeContext {
    return {
        startedAt: Date.now(),
        getMetricsSnapshot: () => ({
            startedAt: Date.now(),
            uptimeMs: 0,
            totalRequests: 0,
            methods: {}
        })
    };
}

beforeEach(() => {
    resetResolverStateForTests();
});

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('daemon request handling', () => {
    it('rejects context-bound operations when no active context exists', () => {
        const { db, graph } = createGraph();
        try {
            expect(() => {
                handleRequest(graph, 'conn-1', {
                    method: 'addNode',
                    params: { type: 'goal', content: 'test node' }
                }, runtime());
            }).toThrow(/No active context set/);
        } finally {
            db.close();
        }
    });

    it('persists active context across socket reconnections using sessionToken', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-a', { method: 'createSession' }, runtime()) as { sessionToken: string };

            const context = handleRequest(graph, 'conn-a', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'enterprise-rollout' }
            }, runtime()) as { id: string };

            const node = handleRequest(graph, 'conn-b', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'decision', content: 'Ship session-aware protocol' }
            }, runtime()) as { contextId: string };

            expect(node.contextId).toBe(context.id);
        } finally {
            db.close();
        }
    });

    it('writes audit events for mutating calls', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-a', { method: 'createSession' }, runtime()) as { sessionToken: string };

            const context = handleRequest(graph, 'conn-a', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'audit-context', actor: 'test-user', source: 'test-suite' }
            }, runtime()) as { id: string };

            handleRequest(graph, 'conn-a', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'goal', content: 'Capture auditable mutations' }
            }, runtime());

            const events = handleRequest(graph, 'conn-a', {
                method: 'listAuditEvents',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, limit: 10 }
            }, runtime()) as Array<{ action: string; sessionToken: string | null }>;

            expect(events.length).toBeGreaterThan(0);
            expect(events.some(event => event.action === 'create_context')).toBe(true);
            expect(events.some(event => event.action === 'add_node')).toBe(true);
            expect(events.every(event => event.sessionToken === session.sessionToken)).toBe(true);
        } finally {
            db.close();
        }
    });

    it('gets and sets per-context sync policy with audit trail', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-sync', { method: 'createSession' }, runtime()) as { sessionToken: string };

            const context = handleRequest(graph, 'conn-sync', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'sync-policy-context', syncPolicy: 'metadata_only' }
            }, runtime()) as { id: string };

            const before = handleRequest(graph, 'conn-sync', {
                method: 'getSyncPolicy',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as { syncPolicy: string };

            const after = handleRequest(graph, 'conn-sync', {
                method: 'setSyncPolicy',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, syncPolicy: 'full_sync', actor: 'test-user', source: 'test-suite' }
            }, runtime()) as { syncPolicy: string };

            const events = handleRequest(graph, 'conn-sync', {
                method: 'listAuditEvents',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, limit: 10 }
            }, runtime()) as Array<{ action: string }>;

            expect(before.syncPolicy).toBe('metadata_only');
            expect(after.syncPolicy).toBe('full_sync');
            expect(events.some(event => event.action === 'set_sync_policy')).toBe(true);
        } finally {
            db.close();
        }
    });

    it('supports temporal, topic, graph, and auto recall methods', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-recall', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-recall', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'recall-context' }
            }, runtime()) as { id: string };

            const first = handleRequest(graph, 'conn-recall', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'goal', content: 'Improve sleep quality with routine' }
            }, runtime()) as { id: string };

            const second = handleRequest(graph, 'conn-recall', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'decision', content: 'Sleep interrupted at 3am, enforce bedtime protocol', tags: ['sleep'] }
            }, runtime()) as { id: string };

            handleRequest(graph, 'conn-recall', {
                method: 'addEdge',
                sessionToken: session.sessionToken,
                params: { fromId: second.id, toId: first.id, relation: 'supersedes' }
            }, runtime());

            const temporal = handleRequest(graph, 'conn-recall', {
                method: 'recallTemporal',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, sinceHours: 24, limit: 10 }
            }, runtime()) as { mode: string; totalEvents: number; sessions: unknown[] };

            const topic = handleRequest(graph, 'conn-recall', {
                method: 'recallTopic',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, query: 'sleep', sinceHours: 24, limit: 10 }
            }, runtime()) as { mode: string; hits: Array<{ nodeId: string; matchReason: string }> };

            const graphRecall = handleRequest(graph, 'conn-recall', {
                method: 'recallGraph',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, query: 'sleep', depth: 2, maxNodes: 20, limit: 5 }
            }, runtime()) as { mode: string; anchors: unknown[]; subgraph: { nodes: unknown[]; edges: unknown[] } };

            const auto = handleRequest(graph, 'conn-recall', {
                method: 'recall',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, mode: 'auto', query: 'sleep', sinceHours: 24, limit: 10 }
            }, runtime()) as { mode: string; summary: { topicHitCount: number; sessionCount: number } };

            expect(temporal.mode).toBe('temporal');
            expect(temporal.totalEvents).toBeGreaterThan(0);
            expect(temporal.sessions.length).toBeGreaterThan(0);

            expect(topic.mode).toBe('topic');
            expect(topic.hits.length).toBeGreaterThan(0);
            expect(topic.hits[0].nodeId).toBeTruthy();
            expect(topic.hits[0].matchReason).toBeTruthy();

            expect(graphRecall.mode).toBe('graph');
            expect(graphRecall.anchors.length).toBeGreaterThan(0);
            expect(graphRecall.subgraph.nodes.length).toBeGreaterThan(0);

            expect(auto.mode).toBe('auto');
            expect(auto.summary.topicHitCount).toBeGreaterThan(0);
            expect(auto.summary.sessionCount).toBeGreaterThan(0);
        } finally {
            db.close();
        }
    });

    it('records recall feedback as an audit event', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-feedback', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-feedback', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'recall-feedback-context' }
            }, runtime()) as { id: string };

            const node = handleRequest(graph, 'conn-feedback', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'artifact', content: 'Recall target node for feedback' }
            }, runtime()) as { id: string };

            const feedback = handleRequest(graph, 'conn-feedback', {
                method: 'recallFeedback',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    nodeId: node.id,
                    helpful: true,
                    reason: 'top result matched user intent'
                }
            }, runtime()) as { ok: boolean; nodeId: string; helpful: boolean };

            const audit = handleRequest(graph, 'conn-feedback', {
                method: 'listAuditEvents',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, limit: 20 }
            }, runtime()) as Array<{ action: string; payload?: Record<string, unknown> }>;
            const listed = handleRequest(graph, 'conn-feedback', {
                method: 'listRecallFeedback',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, limit: 10 }
            }, runtime()) as {
                total: number;
                helpfulCount: number;
                notHelpfulCount: number;
                items: Array<{ nodeId: string; helpful: boolean }>;
            };

            expect(feedback.ok).toBe(true);
            expect(feedback.nodeId).toBe(node.id);
            expect(feedback.helpful).toBe(true);
            expect(audit.some(event => event.action === 'recall_feedback')).toBe(true);
            expect(listed.total).toBeGreaterThanOrEqual(1);
            expect(listed.helpfulCount).toBeGreaterThanOrEqual(1);
            expect(listed.notHelpfulCount).toBe(0);
            expect(listed.items.some(item => item.nodeId === node.id && item.helpful)).toBe(true);
        } finally {
            db.close();
        }
    });

    it('records and polls blackboard events via subscriptions', () => {
        const { db, graph } = createGraph();
        const events = new EventRuntime();
        const ctxRuntime: HandlerRuntimeContext = {
            ...runtime(),
            eventRuntime: events
        };

        try {
            const session = handleRequest(graph, 'conn-a', { method: 'createSession' }, ctxRuntime) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-a', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'blackboard-context' }
            }, ctxRuntime) as { id: string };

            const subscription = handleRequest(graph, 'conn-a', {
                method: 'subscribeEvents',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, types: ['NodeAdded'] }
            }, ctxRuntime) as { subscriptionId: string };

            handleRequest(graph, 'conn-a', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'goal', content: 'Track blackboard events' }
            }, ctxRuntime);

            const polled = handleRequest(graph, 'conn-a', {
                method: 'pollEvents',
                sessionToken: session.sessionToken,
                params: { subscriptionId: subscription.subscriptionId }
            }, ctxRuntime) as { events: Array<{ type: string; contextId: string | null; sequence: number }> };

            expect(polled.events.length).toBeGreaterThan(0);
            expect(polled.events.some(event => event.type === 'NodeAdded')).toBe(true);
            expect(polled.events.every(event => event.contextId === context.id)).toBe(true);
        } finally {
            db.close();
        }
    });

    it('enforces task lease ownership semantics', () => {
        const { db, graph } = createGraph();
        const events = new EventRuntime();
        const ctxRuntime: HandlerRuntimeContext = {
            ...runtime(),
            eventRuntime: events
        };

        try {
            const sessionA = handleRequest(graph, 'conn-a', { method: 'createSession' }, ctxRuntime) as { sessionToken: string };
            const sessionB = handleRequest(graph, 'conn-b', { method: 'createSession' }, ctxRuntime) as { sessionToken: string };

            const claimA = handleRequest(graph, 'conn-a', {
                method: 'claimTask',
                sessionToken: sessionA.sessionToken,
                params: { taskId: 'task-1', leaseMs: 30000 }
            }, ctxRuntime) as { claimed: boolean };

            const claimBWhileHeld = handleRequest(graph, 'conn-b', {
                method: 'claimTask',
                sessionToken: sessionB.sessionToken,
                params: { taskId: 'task-1', leaseMs: 30000 }
            }, ctxRuntime) as { claimed: boolean };

            const releaseA = handleRequest(graph, 'conn-a', {
                method: 'releaseTask',
                sessionToken: sessionA.sessionToken,
                params: { taskId: 'task-1' }
            }, ctxRuntime) as { released: boolean };

            const claimBAfterRelease = handleRequest(graph, 'conn-b', {
                method: 'claimTask',
                sessionToken: sessionB.sessionToken,
                params: { taskId: 'task-1', leaseMs: 30000 }
            }, ctxRuntime) as { claimed: boolean };

            expect(claimA.claimed).toBe(true);
            expect(claimBWhileHeld.claimed).toBe(false);
            expect(releaseA.released).toBe(true);
            expect(claimBAfterRelease.claimed).toBe(true);
        } finally {
            db.close();
        }
    });

    it('evaluates blackboard completion deterministically', () => {
        const { db, graph } = createGraph();
        const events = new EventRuntime();
        const ctxRuntime: HandlerRuntimeContext = {
            ...runtime(),
            eventRuntime: events
        };

        try {
            const session = handleRequest(graph, 'conn-a', { method: 'createSession' }, ctxRuntime) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-a', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'completion-context' }
            }, ctxRuntime) as { id: string };

            handleRequest(graph, 'conn-a', {
                method: 'claimTask',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, taskId: 'task-1', leaseMs: 60_000 }
            }, ctxRuntime);
            handleRequest(graph, 'conn-a', {
                method: 'resolveGate',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, gateId: 'typecheck', status: 'open', severity: 'high' }
            }, ctxRuntime);

            const blocked = handleRequest(graph, 'conn-a', {
                method: 'evaluateCompletion',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, cooldownMs: 0, requiredGates: ['typecheck'] }
            }, ctxRuntime) as { complete: boolean; reasons: string[] };

            handleRequest(graph, 'conn-a', {
                method: 'releaseTask',
                sessionToken: session.sessionToken,
                params: { taskId: 'task-1' }
            }, ctxRuntime);
            handleRequest(graph, 'conn-a', {
                method: 'resolveGate',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, gateId: 'typecheck', status: 'resolved' }
            }, ctxRuntime);

            const complete = handleRequest(graph, 'conn-a', {
                method: 'evaluateCompletion',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, cooldownMs: 0, requiredGates: ['typecheck'] }
            }, ctxRuntime) as { complete: boolean; reasons: string[] };

            expect(blocked.complete).toBe(false);
            expect(blocked.reasons).toContain('open_gates');
            expect(blocked.reasons).toContain('active_leases');
            expect(complete.complete).toBe(true);
            expect(complete.reasons).toHaveLength(0);
        } finally {
            db.close();
        }
    });
});
