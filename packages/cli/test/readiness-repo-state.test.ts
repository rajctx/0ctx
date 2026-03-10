import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepoReadinessCollector } from '../src/cli-core/readiness';

const tempDirs: string[] = [];

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '0ctx-readiness-'));
    tempDirs.push(dir);
    return dir;
}

function writeManagedClaudeRepo(repoRoot: string, contextId: string): void {
    const projectConfigPath = path.join(repoRoot, '.0ctx', 'settings.local.json');
    const claudeConfigPath = path.join(repoRoot, '.claude', 'settings.local.json');
    const captureCommand = '0ctx connector hook ingest --quiet --agent=claude';

    fs.mkdirSync(path.dirname(projectConfigPath), { recursive: true });
    fs.mkdirSync(path.dirname(claudeConfigPath), { recursive: true });

    fs.writeFileSync(projectConfigPath, JSON.stringify({
        version: 1,
        generatedAt: Date.now(),
        projectRoot: repoRoot,
        contextId,
        hooks: [
            {
                agent: 'claude',
                command: captureCommand,
                mode: 'post-chat'
            }
        ]
    }, null, 2), 'utf8');

    fs.writeFileSync(claudeConfigPath, JSON.stringify({
        hooks: {
            SessionStart: [
                {
                    hooks: [
                        {
                            type: 'command',
                            command: '0ctx connector hook session-start --agent=claude'
                        }
                    ]
                }
            ],
            Stop: [
                {
                    hooks: [
                        {
                            type: 'command',
                            command: captureCommand
                        }
                    ]
                }
            ]
        }
    }, null, 2), 'utf8');
}

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('repo readiness local hook manifests', () => {
    it('keeps zero-touch readiness repo-scoped after another repo becomes the latest global hook state', async () => {
        const repoA = createTempDir();
        const repoB = createTempDir();
        writeManagedClaudeRepo(repoA, 'ctx-a');
        writeManagedClaudeRepo(repoB, 'ctx-b');

        const collectRepoReadiness = createRepoReadinessCollector({
            ensureDaemonCapabilities: async () => ({ ok: true, missingMethods: [] }),
            resolveRepoRoot: (repoRoot) => repoRoot ?? repoA,
            selectHookContextId: (contexts, repoRoot) => contexts.find(context => context.paths?.includes(repoRoot ?? ''))?.id ?? null,
            sendToDaemon: async (method: string, params?: Record<string, unknown>) => {
                if (method === 'listContexts') {
                    return [
                        { id: 'ctx-a', name: 'Repo A', paths: [repoA] },
                        { id: 'ctx-b', name: 'Repo B', paths: [repoB] }
                    ];
                }
                if (method === 'getAgentContextPack') {
                    return {
                        workspaceName: params?.contextId === 'ctx-a' ? 'Repo A' : 'Repo B',
                        branch: 'main',
                        workstream: { sessionCount: 1, checkpointCount: 0 }
                    };
                }
                if (method === 'getDataPolicy') {
                    return {
                        syncPolicy: 'metadata_only',
                        captureRetentionDays: 14,
                        debugRetentionDays: 7,
                        debugArtifactsEnabled: false
                    };
                }
                throw new Error(`Unexpected method ${method}`);
            },
            getCurrentWorkstream: () => 'main',
            collectHookHealth: async () => ({
                check: { id: 'hook_state', status: 'pass', message: 'ok' },
                dumpCheck: { id: 'hook_dump_dir', status: 'pass', message: 'ok' },
                details: {
                    statePath: 'state',
                    projectRoot: repoB,
                    projectRootExists: true,
                    projectConfigPath: path.join(repoB, '.0ctx', 'settings.local.json'),
                    projectConfigExists: true,
                    contextId: 'ctx-b',
                    contextIdExists: true,
                    installedAgentCount: 1,
                    agents: [
                        {
                            agent: 'claude',
                            configPath: path.join(repoB, '.claude', 'settings.local.json'),
                            configExists: true,
                            commandPresent: true,
                            sessionStartPresent: true,
                            command: '0ctx connector hook ingest --quiet --agent=claude'
                        }
                    ]
                }
            }),
            defaultHookInstallClients: ['claude', 'factory', 'antigravity'],
            sessionStartAgents: ['claude', 'factory', 'antigravity'],
            isGaHookAgent: (agent) => agent === 'claude' || agent === 'factory' || agent === 'antigravity'
        });

        const readinessA = await collectRepoReadiness({ repoRoot: repoA });
        const readinessB = await collectRepoReadiness({ repoRoot: repoB });

        expect(readinessA?.captureManagedForRepo).toBe(true);
        expect(readinessA?.captureReadyAgents).toEqual(['claude']);
        expect(readinessA?.autoContextAgents).toEqual(['claude']);
        expect(readinessA?.zeroTouchReady).toBe(true);
        expect(readinessA?.nextActionHint).toBeNull();

        expect(readinessB?.captureManagedForRepo).toBe(true);
        expect(readinessB?.captureReadyAgents).toEqual(['claude']);
        expect(readinessB?.autoContextAgents).toEqual(['claude']);
        expect(readinessB?.zeroTouchReady).toBe(true);
        expect(readinessB?.nextActionHint).toBeNull();
    });
});
