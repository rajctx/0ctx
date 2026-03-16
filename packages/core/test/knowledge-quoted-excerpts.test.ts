import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db';
import { Graph } from '../src/graph';

const tempDirs: string[] = [];

function createGraph() {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-core-quoted-'));
    tempDirs.push(tempDir);
    const db = openDb({ dbPath: path.join(tempDir, '0ctx.db') });
    return { db, graph: new Graph(db) };
}

function addSession(graph: Graph, contextId: string, sessionId: string) {
    graph.addNode({
        contextId,
        thread: sessionId,
        type: 'artifact',
        content: 'quoted excerpt session',
        key: `chat_session:factory:${sessionId}`,
        tags: ['chat_session', 'agent:factory'],
        source: 'hook:factory',
        hidden: true,
        rawPayload: { sessionId, branch: 'feature/quoted-excerpts', agent: 'factory' }
    });
}

function addTurn(graph: Graph, contextId: string, sessionId: string, messageId: string, role: 'user' | 'assistant', content: string) {
    graph.addNode({
        contextId,
        thread: sessionId,
        type: 'artifact',
        content,
        key: `chat_turn:factory:${sessionId}:${messageId}`,
        tags: ['chat_turn', `role:${role}`],
        source: 'hook:factory',
        hidden: true,
        rawPayload: { sessionId, messageId, role, branch: 'feature/quoted-excerpts', occurredAt: Date.now() }
    });
}

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('Reviewed insight quoted excerpt filtering', () => {
    it('skips blockquoted source text during session preview', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('knowledge-blockquote-filter');
            addSession(graph, context.id, 'session-quoted-1');
            addTurn(graph, context.id, 'session-quoted-1', 'assistant-1', 'assistant', '> We decided to keep metadata_only as the default sync policy.');

            const preview = graph.previewKnowledgeFromSession(context.id, 'session-quoted-1');
            expect(preview.candidates).toEqual([]);
        } finally {
            db.close();
        }
    });

    it('skips fully quoted excerpts but preserves durable statements with quoted terms', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('knowledge-full-quote-filter');
            addSession(graph, context.id, 'session-quoted-2');
            addTurn(graph, context.id, 'session-quoted-2', 'assistant-1', 'assistant', '"We decided to keep metadata_only as the default sync policy."');
            addTurn(graph, context.id, 'session-quoted-2', 'assistant-2', 'assistant', 'Metadata_only should remain the default sync policy even if the preset name stays "Lean".');

            const preview = graph.previewKnowledgeFromSession(context.id, 'session-quoted-2');
            expect(preview.candidates.some((candidate) => /^we decided to keep metadata_only/i.test(candidate.content))).toBe(false);
            expect(preview.candidates.some((candidate) => /should remain the default sync policy/i.test(candidate.content))).toBe(true);
        } finally {
            db.close();
        }
    });
});
