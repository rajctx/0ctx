import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db';
import { Graph } from '../src/graph';

const tempDirs: string[] = [];

function createGraph() {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-core-false-positive-'));
    tempDirs.push(tempDir);

    const db = openDb({ dbPath: path.join(tempDir, '0ctx.db') });
    return { db, graph: new Graph(db) };
}

function addSession(graph: Graph, contextId: string, sessionId: string) {
    graph.addNode({
        contextId,
        thread: sessionId,
        type: 'artifact',
        content: 'false positive corpus session',
        key: `chat_session:factory:${sessionId}`,
        tags: ['chat_session', 'agent:factory'],
        source: 'hook:factory',
        hidden: true,
        rawPayload: { sessionId, branch: 'feature/insight-corpus', agent: 'factory' }
    });
}

function addTurn(graph: Graph, contextId: string, sessionId: string, messageId: string, role: 'user' | 'assistant', content: string, occurredAt: number) {
    graph.addNode({
        contextId,
        thread: sessionId,
        type: 'artifact',
        content,
        key: `chat_turn:factory:${sessionId}:${messageId}`,
        tags: ['chat_turn', `role:${role}`],
        source: 'hook:factory',
        hidden: true,
        rawPayload: { sessionId, messageId, role, branch: 'feature/insight-corpus', occurredAt }
    });
}

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('Reviewed insight false-positive corpus', () => {
    it('skips copied source text and shipped-status chatter during session preview', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('knowledge-false-positive-noise');
            addSession(graph, context.id, 'session-corpus-1');
            addTurn(graph, context.id, 'session-corpus-1', 'assistant-1', 'assistant', 'From the Linear issue: "We decided to keep metadata_only as the default sync policy."', 1700001201000);
            addTurn(graph, context.id, 'session-corpus-1', 'assistant-2', 'assistant', '> We decided to keep metadata_only as the default sync policy.', 1700001202000);
            addTurn(graph, context.id, 'session-corpus-1', 'assistant-3', 'assistant', 'Shipped delta: workstream compare now includes explicit reconcileSteps in daemon, CLI, and desktop.', 1700001203000);
            addTurn(graph, context.id, 'session-corpus-1', 'assistant-4', 'assistant', 'Validation: npm exec vitest run packages/cli/test/data-policy.test.ts packages/cli/test/repo-readiness-display.test.ts', 1700001204000);
            addTurn(graph, context.id, 'session-corpus-1', 'assistant-5', 'assistant', 'Linear: updated 0CT-25 and closed the validation issue.', 1700001205000);
            addTurn(graph, context.id, 'session-corpus-1', 'assistant-6', 'assistant', 'Remaining work: invisible supported-agent retrieval, deeper git-aware reasoning, and reviewed-insight quality.', 1700001206000);

            const preview = graph.previewKnowledgeFromSession(context.id, 'session-corpus-1');

            expect(preview.candidateCount).toBe(0);
            expect(preview.candidates).toEqual([]);
        } finally {
            db.close();
        }
    });

    it('preserves durable product policy statements when status chatter is mixed into the same session', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('knowledge-false-positive-positive-control');
            addSession(graph, context.id, 'session-corpus-2');
            addTurn(graph, context.id, 'session-corpus-2', 'assistant-1', 'assistant', 'Shipped delta: workstream compare now includes explicit reconcileSteps in daemon, CLI, and desktop.', 1700001207000);
            addTurn(graph, context.id, 'session-corpus-2', 'assistant-2', 'assistant', 'Daemon must remain the source of truth for context state.', 1700001208000);
            addTurn(graph, context.id, 'session-corpus-2', 'assistant-3', 'assistant', 'The normal product path should stay repo-first through 0ctx enable.', 1700001209000);
            addTurn(graph, context.id, 'session-corpus-2', 'assistant-4', 'assistant', 'Linear: updated 0CT-25 and closed the validation issue.', 1700001210000);

            const preview = graph.previewKnowledgeFromSession(context.id, 'session-corpus-2');
            const contents = preview.candidates.map((candidate) => candidate.content);

            expect(contents).toContain('Daemon must remain the source of truth for context state.');
            expect(contents).toContain('The normal product path should stay repo-first through 0ctx enable.');
            expect(contents.some((content) => content.includes('Shipped delta:'))).toBe(false);
            expect(contents.some((content) => content.includes('Linear:'))).toBe(false);
        } finally {
            db.close();
        }
    });
});
