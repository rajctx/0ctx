import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Graph, openDb } from '@0ctx/core';
import { handleRequest } from '../src/handlers';
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
});
