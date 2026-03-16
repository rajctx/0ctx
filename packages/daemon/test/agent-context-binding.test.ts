import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { Graph, openDb } from '@0ctx/core';
import { buildAgentContextPack } from '../src/workstream/agent-context';

const tempDirs: string[] = [];

function createGraph() {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-agent-context-'));
    tempDirs.push(tempDir);
    const db = openDb({ dbPath: path.join(tempDir, '0ctx.db') });
    return { db, graph: new Graph(db) };
}

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('agent context tool bindings', () => {
    it('includes explicit context, worktree, and branch bindings in the injected prompt', () => {
        const { db, graph } = createGraph();
        const repoRoot = mkdtempSync(path.join(os.tmpdir(), '0ctx-agent-context-repo-'));
        tempDirs.push(repoRoot);

        try {
            const context = graph.createContext('binding-context', [repoRoot]);
            const pack = buildAgentContextPack(graph, context.id, {
                branch: 'feature/runtime-shape',
                worktreePath: repoRoot
            });

            expect(pack.promptText).toContain(`Tool binding: Always set contextId to ${context.id} on 0ctx tool calls in this chat.`);
            expect(pack.promptText).toContain(`Worktree binding: When a 0ctx tool accepts worktreePath, pass ${repoRoot}.`);
            expect(pack.promptText).toContain('Branch binding: When a 0ctx tool accepts branch, use feature/runtime-shape.');
        } finally {
            db.close();
        }
    });

    it('still includes a workspace binding even when no worktree is resolved', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('workspace-only-context');
            const pack = buildAgentContextPack(graph, context.id, {});

            expect(pack.promptText).toContain(`Tool binding: Always set contextId to ${context.id} on 0ctx tool calls in this chat.`);
            expect(pack.promptText).not.toContain('Worktree binding:');
        } finally {
            db.close();
        }
    });
});
