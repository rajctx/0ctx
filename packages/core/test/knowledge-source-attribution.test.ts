import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db';
import { Graph } from '../src/graph';

const tempDirs: string[] = [];

function createGraph() {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-core-knowledge-'));
    tempDirs.push(tempDir);

    const db = openDb({ dbPath: path.join(tempDir, '0ctx.db') });
    return { db, graph: new Graph(db) };
}

function addSession(graph: Graph, contextId: string, sessionId: string) {
    graph.addNode({
        contextId,
        thread: sessionId,
        type: 'artifact',
        content: 'source attribution session',
        key: `chat_session:factory:${sessionId}`,
        tags: ['chat_session', 'agent:factory'],
        source: 'hook:factory',
        hidden: true,
        rawPayload: {
            sessionId,
            branch: 'feature/reviewed-insight-source-attribution',
            agent: 'factory'
        }
    });
}

function addTurn(
    graph: Graph,
    contextId: string,
    sessionId: string,
    messageId: string,
    role: 'user' | 'assistant',
    content: string,
    occurredAt: number
) {
    graph.addNode({
        contextId,
        thread: sessionId,
        type: 'artifact',
        content,
        key: `chat_turn:factory:${sessionId}:${messageId}`,
        tags: ['chat_turn', `role:${role}`],
        source: 'hook:factory',
        hidden: true,
        rawPayload: {
            sessionId,
            messageId,
            role,
            branch: 'feature/reviewed-insight-source-attribution',
            occurredAt
        }
    });
}

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('Reviewed insight source attribution filtering', () => {
    it('skips source-attributed quoted decisions during session preview', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('knowledge-source-attribution-session');
            addSession(graph, context.id, 'session-attribution-1');
            addTurn(
                graph,
                context.id,
                'session-attribution-1',
                'assistant-1',
                'assistant',
                'From the Linear issue: "We decided to keep metadata_only as the default sync policy."',
                1700001001000
            );

            const preview = graph.previewKnowledgeFromSession(context.id, 'session-attribution-1');
            expect(preview.candidateCount).toBe(0);
            expect(preview.candidates).toEqual([]);
        } finally {
            db.close();
        }
    });

    it('does not upgrade repeated attributed quotes into strong reviewed insights', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('knowledge-source-attribution-repeated');
            addSession(graph, context.id, 'session-attribution-2');
            addTurn(
                graph,
                context.id,
                'session-attribution-2',
                'user-1',
                'user',
                'According to the Linear issue, we decided to keep metadata_only as the default sync policy.',
                1700001002000
            );
            addTurn(
                graph,
                context.id,
                'session-attribution-2',
                'assistant-1',
                'assistant',
                'The Linear issue says we decided to keep metadata_only as the default sync policy.',
                1700001003000
            );

            const preview = graph.previewKnowledgeFromSession(context.id, 'session-attribution-2');
            expect(preview.candidates).toEqual([]);
            expect(preview.candidates.some((candidate) => candidate.reviewTier === 'strong')).toBe(false);
        } finally {
            db.close();
        }
    });

    it('ignores checkpoint summaries that only quote another source', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('knowledge-source-attribution-checkpoint');
            const checkpoint = graph.saveCheckpoint(
                context.id,
                'From the Linear issue: "We decided to keep metadata_only as the default sync policy."'
            );

            const preview = graph.previewKnowledgeFromCheckpoint(checkpoint.id);
            expect(preview.candidateCount).toBe(0);
            expect(preview.candidates).toEqual([]);
        } finally {
            db.close();
        }
    });
});
