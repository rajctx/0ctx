import { describe, expect, it, vi } from 'vitest';
import { createRepoReadinessCollector } from '../src/cli-core/readiness';

describe('repo readiness collector', () => {
    it('requests repo readiness from the daemon using the resolved repo root', async () => {
        const ensureDaemonCapabilities = vi.fn(async () => ({ ok: true, missingMethods: [] }));
        const resolveRepoRoot = vi.fn((repoRoot?: string | null) => repoRoot ?? 'C:\\repo');
        const sendToDaemon = vi.fn(async () => ({
            repoRoot: 'C:\\repo',
            contextId: 'ctx-1',
            workspaceName: 'Repo',
            workstream: 'main',
            sessionCount: 2,
            checkpointCount: 1,
            syncPolicy: 'metadata_only',
            syncScope: 'workspace',
            captureScope: 'machine',
            debugScope: 'machine',
            captureReadyAgents: ['claude'],
            autoContextAgents: ['claude'],
            autoContextMissingAgents: [],
            sessionStartMissingAgents: [],
            mcpRegistrationMissingAgents: [],
            captureMissingAgents: [],
            captureManagedForRepo: true,
            zeroTouchReady: true,
            nextActionHint: null,
            dataPolicyPreset: 'lean',
            dataPolicyActionHint: null,
            captureRetentionDays: 14,
            debugRetentionDays: 7,
            debugArtifactsEnabled: false
        }));

        const collectRepoReadiness = createRepoReadinessCollector({
            ensureDaemonCapabilities,
            resolveRepoRoot,
            sendToDaemon
        });

        const readiness = await collectRepoReadiness({ repoRoot: 'C:\\repo', contextId: 'ctx-1' });

        expect(ensureDaemonCapabilities).toHaveBeenCalledWith(['getRepoReadiness']);
        expect(resolveRepoRoot).toHaveBeenCalledWith('C:\\repo');
        expect(sendToDaemon).toHaveBeenCalledWith('getRepoReadiness', {
            repoRoot: 'C:\\repo',
            contextId: 'ctx-1'
        });
        expect(readiness?.zeroTouchReady).toBe(true);
        expect(readiness?.autoContextAgents).toEqual(['claude']);
    });

    it('fails fast when the daemon does not expose repo readiness', async () => {
        const collectRepoReadiness = createRepoReadinessCollector({
            ensureDaemonCapabilities: async () => ({ ok: false, missingMethods: ['getRepoReadiness'], error: null }),
            resolveRepoRoot: (repoRoot?: string | null) => repoRoot ?? 'C:\\repo',
            sendToDaemon: async () => {
                throw new Error('should not reach daemon');
            }
        });

        await expect(collectRepoReadiness({ repoRoot: 'C:\\repo' }))
            .rejects
            .toThrow(/daemon capabilities stale: getRepoReadiness/i);
    });
});
