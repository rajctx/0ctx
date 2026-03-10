import { describe, expect, it } from 'vitest';
import { createRepoReadinessCollector } from '../src/cli-core/readiness';

describe('repo readiness', () => {
    it('ignores preview-only integrations in the normal readiness path', async () => {
        const collectRepoReadiness = createRepoReadinessCollector({
            ensureDaemonCapabilities: async () => ({ ok: true, missingMethods: [] }),
            resolveRepoRoot: (repoRoot) => repoRoot ?? 'C:\\repo',
            selectHookContextId: (contexts, repoRoot) => {
                const matched = contexts.find(context => Array.isArray(context.paths) && context.paths.includes(repoRoot ?? ''));
                return matched?.id ?? null;
            },
            sendToDaemon: async (method: string) => {
                if (method === 'listContexts') {
                    return [{ id: 'ctx-1', name: 'Repo', paths: ['C:\\repo'] }];
                }
                if (method === 'getAgentContextPack') {
                    return {
                        workspaceName: 'Repo',
                        branch: 'main',
                        workstream: { sessionCount: 0, checkpointCount: 0 }
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
                    projectRoot: 'C:\\repo',
                    projectRootExists: true,
                    projectConfigPath: 'config',
                    projectConfigExists: true,
                    contextId: 'ctx-1',
                    contextIdExists: true,
                    installedAgentCount: 1,
                    agents: [
                        {
                            agent: 'codex',
                            configPath: 'config.toml',
                            configExists: true,
                            commandPresent: true,
                            sessionStartPresent: false,
                            command: '0ctx connector hook ingest --agent=codex'
                        }
                    ]
                }
            }),
            defaultHookInstallClients: ['claude', 'factory', 'antigravity'],
            sessionStartAgents: ['claude', 'factory', 'antigravity'],
            isGaHookAgent: (agent) => agent === 'claude' || agent === 'factory' || agent === 'antigravity'
        });

        const readiness = await collectRepoReadiness({ repoRoot: 'C:\\repo' });
        expect(readiness).not.toBeNull();
        expect(readiness?.captureReadyAgents).toEqual([]);
        expect(readiness?.zeroTouchReady).toBe(false);
        expect(readiness?.nextActionHint).toBe('Run 0ctx enable to install supported capture integrations.');
    });

    it('treats equivalent Windows repo paths as the same managed repo', async () => {
        const collectRepoReadiness = createRepoReadinessCollector({
            ensureDaemonCapabilities: async () => ({ ok: true, missingMethods: [] }),
            resolveRepoRoot: (repoRoot) => repoRoot ?? 'C:/repo',
            selectHookContextId: (contexts) => contexts[0]?.id ?? null,
            sendToDaemon: async (method: string) => {
                if (method === 'listContexts') {
                    return [{ id: 'ctx-1', name: 'Repo', paths: ['C:/repo'] }];
                }
                if (method === 'getAgentContextPack') {
                    return {
                        workspaceName: 'Repo',
                        branch: 'main',
                        workstream: { sessionCount: 2, checkpointCount: 1 }
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
                    projectRoot: 'C:\\repo',
                    projectRootExists: true,
                    projectConfigPath: 'config',
                    projectConfigExists: true,
                    contextId: 'ctx-1',
                    contextIdExists: true,
                    installedAgentCount: 3,
                    agents: [
                        { agent: 'claude', configPath: 'a', configExists: true, commandPresent: true, sessionStartPresent: true, command: '0ctx connector hook ingest --agent=claude' },
                        { agent: 'factory', configPath: 'b', configExists: true, commandPresent: true, sessionStartPresent: true, command: '0ctx connector hook ingest --agent=factory' },
                        { agent: 'antigravity', configPath: 'c', configExists: true, commandPresent: true, sessionStartPresent: true, command: '0ctx connector hook ingest --agent=antigravity' }
                    ]
                }
            }),
            defaultHookInstallClients: ['claude', 'factory', 'antigravity'],
            sessionStartAgents: ['claude', 'factory', 'antigravity'],
            isGaHookAgent: (agent) => agent === 'claude' || agent === 'factory' || agent === 'antigravity'
        });

        const readiness = await collectRepoReadiness({ repoRoot: 'C:/repo' });
        expect(readiness?.captureManagedForRepo).toBe(true);
        expect(readiness?.captureReadyAgents).toEqual(['claude', 'factory', 'antigravity']);
        expect(readiness?.zeroTouchReady).toBe(true);
    });

    it('does not mark zero-touch ready when capture exists without SessionStart injection', async () => {
        const collectRepoReadiness = createRepoReadinessCollector({
            ensureDaemonCapabilities: async () => ({ ok: true, missingMethods: [] }),
            resolveRepoRoot: (repoRoot) => repoRoot ?? 'C:\\repo',
            selectHookContextId: (contexts) => contexts[0]?.id ?? null,
            sendToDaemon: async (method: string) => {
                if (method === 'listContexts') {
                    return [{ id: 'ctx-1', name: 'Repo', paths: ['C:\\repo'] }];
                }
                if (method === 'getAgentContextPack') {
                    return {
                        workspaceName: 'Repo',
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
                    projectRoot: 'C:\\repo',
                    projectRootExists: true,
                    projectConfigPath: 'config',
                    projectConfigExists: true,
                    contextId: 'ctx-1',
                    contextIdExists: true,
                    installedAgentCount: 1,
                    agents: [
                        { agent: 'claude', configPath: 'a', configExists: true, commandPresent: true, sessionStartPresent: false, command: '0ctx connector hook ingest --agent=claude' }
                    ]
                }
            }),
            defaultHookInstallClients: ['claude', 'factory', 'antigravity'],
            sessionStartAgents: ['claude', 'factory', 'antigravity'],
            isGaHookAgent: (agent) => agent === 'claude' || agent === 'factory' || agent === 'antigravity'
        });

        const readiness = await collectRepoReadiness({ repoRoot: 'C:\\repo' });
        expect(readiness?.captureReadyAgents).toEqual(['claude']);
        expect(readiness?.autoContextAgents).toEqual([]);
        expect(readiness?.zeroTouchReady).toBe(false);
        expect(readiness?.nextActionHint).toContain('automatic context injection');
    });
});
