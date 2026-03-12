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

    it('skips repo-readiness and automatic-retrieval status chatter during session preview', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('knowledge-false-positive-readiness');
            addSession(graph, context.id, 'session-corpus-3');
            addTurn(graph, context.id, 'session-corpus-3', 'assistant-1', 'assistant', 'Ready: zero-touch for supported agents.', 1700001211000);
            addTurn(graph, context.id, 'session-corpus-3', 'assistant-2', 'assistant', 'Next step: Complete one-time context setup for Claude and Antigravity.', 1700001212000);
            addTurn(graph, context.id, 'session-corpus-3', 'assistant-3', 'assistant', 'Automatic context is ready once supported integrations are installed.', 1700001213000);

            const preview = graph.previewKnowledgeFromSession(context.id, 'session-corpus-3');

            expect(preview.candidateCount).toBe(0);
            expect(preview.candidates).toEqual([]);
        } finally {
            db.close();
        }
    });

    it('skips workstream reconcile steps and git action hints during session preview', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('knowledge-false-positive-workstream-actions');
            addSession(graph, context.id, 'session-corpus-4');
            addTurn(graph, context.id, 'session-corpus-4', 'assistant-1', 'assistant', 'Commit or checkpoint local changes before handing this workstream to another agent.', 1700001214000);
            addTurn(graph, context.id, 'session-corpus-4', 'assistant-2', 'assistant', 'Open the checked-out worktree before continuing on this workstream.', 1700001215000);
            addTurn(graph, context.id, 'session-corpus-4', 'assistant-3', 'assistant', 'Rebase onto main before relying on this workstream for handoff.', 1700001216000);
            addTurn(graph, context.id, 'session-corpus-4', 'assistant-4', 'assistant', 'The daemon must remain the source of truth for context state.', 1700001217000);

            const preview = graph.previewKnowledgeFromSession(context.id, 'session-corpus-4');
            const contents = preview.candidates.map((candidate) => candidate.content);

            expect(contents).not.toContain('Commit or checkpoint local changes before handing this workstream to another agent.');
            expect(contents).not.toContain('Open the checked-out worktree before continuing on this workstream.');
            expect(contents).not.toContain('Rebase onto main before relying on this workstream for handoff.');
            expect(contents).toContain('The daemon must remain the source of truth for context state.');
        } finally {
            db.close();
        }
    });

    it('skips system-generated workstream context and readiness summaries during session preview', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('knowledge-false-positive-system-context');
            addSession(graph, context.id, 'session-corpus-5');
            addTurn(graph, context.id, 'session-corpus-5', 'assistant-1', 'assistant', 'Workspace: 0ctx-dev', 1700001218000);
            addTurn(graph, context.id, 'session-corpus-5', 'assistant-2', 'assistant', 'Current workstream: feat/v1', 1700001219000);
            addTurn(graph, context.id, 'session-corpus-5', 'assistant-3', 'assistant', 'No captured sessions or checkpoints for this workstream yet.', 1700001220000);
            addTurn(graph, context.id, 'session-corpus-5', 'assistant-4', 'assistant', 'Checked out elsewhere (feature-worktree)', 1700001221000);
            addTurn(graph, context.id, 'session-corpus-5', 'assistant-5', 'assistant', 'Working tree has local uncommitted changes.', 1700001222000);
            addTurn(graph, context.id, 'session-corpus-5', 'assistant-6', 'assistant', 'The daemon must remain the source of truth for project state.', 1700001223000);

            const preview = graph.previewKnowledgeFromSession(context.id, 'session-corpus-5');
            const contents = preview.candidates.map((candidate) => candidate.content);

            expect(contents).not.toContain('Workspace: 0ctx-dev');
            expect(contents).not.toContain('Current workstream: feat/v1');
            expect(contents).not.toContain('No captured sessions or checkpoints for this workstream yet.');
            expect(contents).not.toContain('Checked out elsewhere (feature-worktree)');
            expect(contents).not.toContain('Working tree has local uncommitted changes.');
            expect(contents).toContain('The daemon must remain the source of truth for project state.');
        } finally {
            db.close();
        }
    });

    it('skips progress and coordination chatter while preserving durable architectural questions', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('knowledge-false-positive-progress');
            addSession(graph, context.id, 'session-corpus-6');
            addTurn(graph, context.id, 'session-corpus-6', 'user-1', 'user', 'How much of work is remaining now, and are we done?', 1700001224000);
            addTurn(graph, context.id, 'session-corpus-6', 'user-2', 'user', 'Please continue and update Linear with the child tasks.', 1700001225000);
            addTurn(graph, context.id, 'session-corpus-6', 'user-3', 'user', 'How should cross-context retrieval work for agents when two workspaces share reviewed insights?', 1700001226000);

            const preview = graph.previewKnowledgeFromSession(context.id, 'session-corpus-6');
            const contents = preview.candidates.map((candidate) => candidate.content);

            expect(contents).not.toContain('How much of work is remaining now, and are we done?');
            expect(contents).not.toContain('Please continue and update Linear with the child tasks.');
            expect(contents).toContain('How should cross-context retrieval work for agents when two workspaces share reviewed insights?');
        } finally {
            db.close();
        }
    });

    it('skips reviewed-insight trust summaries and setup policy helper copy during session preview', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('knowledge-false-positive-trust-copy');
            addSession(graph, context.id, 'session-corpus-7');
            addTurn(graph, context.id, 'session-corpus-7', 'assistant-1', 'assistant', 'Trust summary: Repeated 2 times across user and assistant messages in 2 sessions.', 1700001227000);
            addTurn(graph, context.id, 'session-corpus-7', 'assistant-2', 'assistant', 'Promotion summary: Review before promoting: 2 corroborating sessions. This insight is usable, but still needs human judgment.', 1700001228000);
            addTurn(graph, context.id, 'session-corpus-7', 'assistant-3', 'assistant', 'Workspace sync: metadata_only (default) | Machine capture: 14-day retention.', 1700001229000);
            addTurn(graph, context.id, 'session-corpus-7', 'assistant-4', 'assistant', 'The supported path is active. Use Utilities only when enabling another repo or changing machine defaults deliberately.', 1700001230000);
            addTurn(graph, context.id, 'session-corpus-7', 'assistant-5', 'assistant', 'We decided raw payload inspection should stay utility-only.', 1700001231000);

            const preview = graph.previewKnowledgeFromSession(context.id, 'session-corpus-7');
            const contents = preview.candidates.map((candidate) => candidate.content);

            expect(contents).not.toContain('Trust summary: Repeated 2 times across user and assistant messages in 2 sessions.');
            expect(contents).not.toContain('Promotion summary: Review before promoting: 2 corroborating sessions. This insight is usable, but still needs human judgment.');
            expect(contents).not.toContain('Workspace sync: metadata_only (default) | Machine capture: 14-day retention.');
            expect(contents).not.toContain('The supported path is active. Use Utilities only when enabling another repo or changing machine defaults deliberately.');
            expect(contents).toContain('We decided raw payload inspection should stay utility-only.');
        } finally {
            db.close();
        }
    });

    it('skips subjective product-evaluation chatter while preserving durable policy statements', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('knowledge-false-positive-evaluation');
            addSession(graph, context.id, 'session-corpus-8');
            addTurn(graph, context.id, 'session-corpus-8', 'assistant-1', 'assistant', 'The desktop app now feels cleaner and more usable.', 1700001232000);
            addTurn(graph, context.id, 'session-corpus-8', 'assistant-2', 'assistant', 'The management surface looks more intentional and production-ready now.', 1700001233000);
            addTurn(graph, context.id, 'session-corpus-8', 'assistant-3', 'assistant', 'The normal product path must stay repo-first through 0ctx enable.', 1700001234000);

            const preview = graph.previewKnowledgeFromSession(context.id, 'session-corpus-8');
            const contents = preview.candidates.map((candidate) => candidate.content);

            expect(contents).not.toContain('The desktop app now feels cleaner and more usable.');
            expect(contents).not.toContain('The management surface looks more intentional and production-ready now.');
            expect(contents).toContain('The normal product path must stay repo-first through 0ctx enable.');
        } finally {
            db.close();
        }
    });
});
