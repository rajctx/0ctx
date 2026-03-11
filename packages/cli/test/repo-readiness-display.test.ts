import { describe, expect, it } from 'vitest';
import { buildRepoReadinessLines } from '../src/commands/product/repo-readiness-display';

describe('repo readiness display', () => {
    it('prints shared as a workspace override with explicit full_sync opt-in in the normal repo readiness path', () => {
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
                autoContextMissingAgents: [],
                sessionStartMissingAgents: [],
                mcpRegistrationMissingAgents: [],
                syncPolicy: 'full_sync',
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
            formatSyncPolicyLabel: (policy) => policy === 'full_sync' ? 'full_sync (opt-in)' : String(policy ?? '')
        });

        expect(lines).toContain('Policy mode: Shared (workspace override)');
        expect(lines).toContain('Workspace sync: full_sync (opt-in)');
        expect(lines).toContain('Policy step: Return this workspace to Lean when richer cloud sync is no longer needed.');
    });

    it('marks review as a machine-default policy mode instead of a workspace override', () => {
        const lines = buildRepoReadinessLines({
            mode: 'enable',
            repoReadiness: {
                repoRoot: 'C:\\repo',
                contextId: 'ctx-1',
                workspaceName: 'Repo',
                workstream: 'main',
                sessionCount: 1,
                checkpointCount: 0,
                captureManagedForRepo: true,
                captureReadyAgents: ['claude'],
                captureMissingAgents: [],
                autoContextAgents: ['claude'],
                autoContextMissingAgents: [],
                sessionStartMissingAgents: [],
                mcpRegistrationMissingAgents: [],
                syncPolicy: 'metadata_only',
                syncScope: 'workspace',
                captureScope: 'machine',
                debugScope: 'machine',
                zeroTouchReady: true,
                nextActionHint: null,
                dataPolicyPreset: 'review',
                dataPolicyActionHint: 'Return this machine to Lean when the longer local review window is no longer needed.',
                captureRetentionDays: 30,
                debugRetentionDays: 7,
                debugArtifactsEnabled: false
            },
            formatAgentList: (agents) => agents.join(', '),
            formatLabelValue: (label, value) => `${label}: ${value}`,
            formatRetentionLabel: (summary) => `${summary.captureRetentionDays}d local capture`,
            formatSyncPolicyLabel: (policy) => String(policy ?? '')
        });

        expect(lines).toContain('Policy mode: Review (machine default)');
        expect(lines).toContain('Workspace sync: metadata_only');
        expect(lines).toContain('Machine capture: 30d local capture');
    });

    it('does not accuse undetected GA agents of being missing in the normal readiness display', () => {
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
                captureMissingAgents: [],
                autoContextAgents: ['claude'],
                autoContextMissingAgents: [],
                sessionStartMissingAgents: [],
                mcpRegistrationMissingAgents: [],
                syncPolicy: 'metadata_only',
                syncScope: 'workspace',
                captureScope: 'machine',
                debugScope: 'machine',
                zeroTouchReady: true,
                nextActionHint: null,
                dataPolicyPreset: 'lean',
                dataPolicyActionHint: null,
                captureRetentionDays: 14,
                debugRetentionDays: 7,
                debugArtifactsEnabled: false
            },
            formatAgentList: (agents) => agents.join(', '),
            formatLabelValue: (label, value) => `${label}: ${value}`,
            formatRetentionLabel: (summary) => `${summary.captureRetentionDays}d local capture`,
            formatSyncPolicyLabel: (policy) => String(policy ?? '')
        });

        expect(lines).toContain('Capture: claude ready');
        expect(lines.some((line) => line.includes('not installed'))).toBe(false);
    });

    it('keeps zero-touch context ready when session-start works but deeper retrieval is still optional', () => {
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
                captureMissingAgents: [],
                autoContextAgents: ['claude'],
                autoContextMissingAgents: [],
                sessionStartMissingAgents: [],
                mcpRegistrationMissingAgents: ['claude'],
                syncPolicy: 'metadata_only',
                syncScope: 'workspace',
                captureScope: 'machine',
                debugScope: 'machine',
                zeroTouchReady: true,
                nextActionHint: null,
                dataPolicyPreset: 'lean',
                dataPolicyActionHint: null,
                captureRetentionDays: 14,
                debugRetentionDays: 7,
                debugArtifactsEnabled: false
            },
            formatAgentList: (agents) => agents.join(', '),
            formatLabelValue: (label, value) => `${label}: ${value}`,
            formatRetentionLabel: (summary) => `${summary.captureRetentionDays}d local capture`,
            formatSyncPolicyLabel: (policy) => String(policy ?? '')
        });

        expect(lines).toContain('Ready: zero-touch for supported agents');
        expect(lines).toContain('Context: claude inject current workstream context automatically');
        expect(lines.some((line) => line.includes('need automatic retrieval setup'))).toBe(false);
    });
});
