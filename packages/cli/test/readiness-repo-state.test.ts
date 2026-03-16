import { describe, expect, it, vi } from 'vitest';
import { createRepoReadinessCollector } from '../src/cli-core/readiness';

describe('repo readiness repo-state wiring', () => {
    it('uses the resolved repo root even when path normalization differs at the call site', async () => {
        const resolveRepoRoot = vi.fn((repoRoot?: string | null) => (repoRoot ?? 'C:/repo').replace(/\//g, '\\'));
        const sendToDaemon = vi.fn(async () => ({
            repoRoot: 'C:\\repo',
            contextId: 'ctx-1',
            workspaceName: 'Repo',
            workstream: 'main',
            sessionCount: 1,
            checkpointCount: 0,
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
            ensureDaemonCapabilities: async () => ({ ok: true, missingMethods: [] }),
            resolveRepoRoot,
            sendToDaemon
        });

        const readiness = await collectRepoReadiness({ repoRoot: 'C:/repo' });

        expect(resolveRepoRoot).toHaveBeenCalledWith('C:/repo');
        expect(sendToDaemon).toHaveBeenCalledWith('getRepoReadiness', {
            repoRoot: 'C:\\repo',
            contextId: null
        });
        expect(readiness?.repoRoot).toBe('C:\\repo');
        expect(readiness?.captureManagedForRepo).toBe(true);
    });
});
