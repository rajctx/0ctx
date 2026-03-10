import { describe, expect, it } from 'vitest';
import { buildRepoReadinessLines } from '../src/commands/product/repo-readiness-display';

describe('repo readiness display', () => {
    it('prints the resolved data policy preset explicitly in the normal repo readiness path', () => {
        const lines = buildRepoReadinessLines({
            mode: 'status',
            repoReadiness: {
                repoRoot: 'C:\\repo',
                contextId: 'ctx-1',
                workspaceName: 'Repo',
                workstream: 'main',
                sessionCount: 2,
                checkpointCount: 1,
                captureManagedForRepo: true,
                captureReadyAgents: ['claude'],
                captureMissingAgents: ['factory', 'antigravity'],
                autoContextAgents: ['claude'],
                syncPolicy: 'metadata_only',
                syncScope: 'workspace',
                captureScope: 'machine',
                debugScope: 'machine',
                zeroTouchReady: true,
                nextActionHint: null,
                dataPolicyPreset: 'shared',
                dataPolicyActionHint: 'Return this workspace to Lean when richer cloud sync is no longer needed.',
                captureRetentionDays: 14,
                debugRetentionDays: 7,
                debugArtifactsEnabled: false
            },
            formatAgentList: (agents) => agents.join(', '),
            formatLabelValue: (label, value) => `${label}: ${value}`,
            formatRetentionLabel: (summary) => `${summary.captureRetentionDays}d local capture`,
            formatSyncPolicyLabel: (policy) => String(policy ?? '')
        });

        expect(lines).toContain('Policy mode: Shared (opt-in)');
        expect(lines).toContain('Workspace sync: metadata_only');
        expect(lines).toContain('Policy step: Return this workspace to Lean when richer cloud sync is no longer needed.');
    });
});
