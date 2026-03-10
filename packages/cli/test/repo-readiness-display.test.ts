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
                autoContextMissingAgents: [],
                sessionStartMissingAgents: [],
                mcpRegistrationMissingAgents: [],
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

    it('does not claim automatic retrieval when Claude still needs MCP registration', () => {
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
                autoContextAgents: [],
                autoContextMissingAgents: ['claude'],
                sessionStartMissingAgents: [],
                mcpRegistrationMissingAgents: ['claude'],
                syncPolicy: 'metadata_only',
                syncScope: 'workspace',
                captureScope: 'machine',
                debugScope: 'machine',
                zeroTouchReady: false,
                nextActionHint: 'Register the 0ctx MCP server for claude.',
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

        expect(lines).toContain('Context: claude need 0ctx MCP registration');
        expect(lines.some((line) => line.includes('inject current workstream context automatically'))).toBe(false);
    });
});
