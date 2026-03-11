import { describe, expect, it, vi } from 'vitest';
import * as client from '@0ctx/mcp/dist/client';
import { createDataPolicyCommands } from '../src/commands/product/policy/data-policy';

describe('data-policy command surface', () => {
    it('returns the preset catalog for the presets subcommand', async () => {
        let captured: unknown = null;
        const { commandDataPolicy } = createDataPolicyCommands({
            requireCommandContextId: async () => null,
            resolveCommandContextId: async () => null,
            parseOptionalStringFlag: (value) => typeof value === 'string' ? value : null,
            parseOptionalPositiveNumberFlag: () => null,
            parseOptionalBooleanLikeFlag: () => null,
            ensureDaemonCapabilities: async () => ({
                ok: true,
                reachable: true,
                apiVersion: '2',
                methods: [],
                missingMethods: [],
                error: null,
                recoverySteps: []
            }),
            printCapabilityMismatch: vi.fn(),
            formatSyncPolicyLabel: (policy) => String(policy ?? ''),
            formatDebugArtifactsLabel: (enabled) => enabled ? 'enabled' : 'disabled',
            printJsonOrValue: (_asJson, value) => {
                captured = value;
                return 0;
            },
            pruneHookDumps: vi.fn(() => ({
                rootDir: 'C:/tmp',
                maxAgeDays: 14,
                debugMaxAgeDays: 7,
                debugArtifactsEnabled: false,
                deletedFiles: 0,
                deletedDirs: 0,
                reclaimedBytes: 0,
                prunedPaths: []
            }))
        });

        const code = await commandDataPolicy('presets', { json: true });

        expect(code).toBe(0);
        expect(captured).toMatchObject({
            recommended: 'lean'
        });
        expect((captured as { presets: Array<{ preset: string }> }).presets.map((item) => item.preset)).toEqual([
            'lean',
            'review',
            'debug',
            'shared'
        ]);
    });

    it('prints scoped preset labels and keeps shared tied to full_sync opt-in in the catalog', async () => {
        const lines: string[] = [];
        const log = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
            lines.push(String(value ?? ''));
        });

        const { commandDataPolicy } = createDataPolicyCommands({
            requireCommandContextId: async () => null,
            resolveCommandContextId: async () => null,
            parseOptionalStringFlag: (value) => typeof value === 'string' ? value : null,
            parseOptionalPositiveNumberFlag: () => null,
            parseOptionalBooleanLikeFlag: () => null,
            ensureDaemonCapabilities: async () => ({
                ok: true,
                reachable: true,
                apiVersion: '2',
                methods: [],
                missingMethods: [],
                error: null,
                recoverySteps: []
            }),
            printCapabilityMismatch: vi.fn(),
            formatSyncPolicyLabel: (policy) => policy === 'full_sync' ? 'full_sync (opt-in)' : policy === 'metadata_only' ? 'metadata_only (default)' : String(policy ?? ''),
            formatDebugArtifactsLabel: (enabled) => enabled ? 'enabled' : 'disabled',
            printJsonOrValue: (_asJson, _value, render) => {
                render();
                return 0;
            },
            pruneHookDumps: vi.fn(() => ({
                rootDir: 'C:/tmp',
                maxAgeDays: 14,
                debugMaxAgeDays: 7,
                debugArtifactsEnabled: false,
                deletedFiles: 0,
                deletedDirs: 0,
                reclaimedBytes: 0,
                prunedPaths: []
            }))
        });

        const code = await commandDataPolicy('presets', {});

        expect(code).toBe(0);
        expect(lines.some((line) => line.includes('Lean (machine default)'))).toBe(true);
        expect(lines.some((line) => line.includes('Review (machine default)'))).toBe(true);
        expect(lines.some((line) => line.includes('Debug (machine default)'))).toBe(true);
        expect(lines.some((line) => line.includes('Shared (workspace override)'))).toBe(true);
        expect(lines.some((line) => line.includes('Workspace sync:') && line.includes('full_sync (opt-in)'))).toBe(true);
        log.mockRestore();
    });

    it('prints a single normal-path summary for human output', async () => {
        const lines: string[] = [];
        const log = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
            lines.push(String(value ?? ''));
        });

        const { commandDataPolicy } = createDataPolicyCommands({
            requireCommandContextId: async () => null,
            resolveCommandContextId: async () => 'ctx-1',
            parseOptionalStringFlag: (value) => typeof value === 'string' ? value : null,
            parseOptionalPositiveNumberFlag: () => null,
            parseOptionalBooleanLikeFlag: () => null,
            ensureDaemonCapabilities: async () => ({
                ok: true,
                reachable: true,
                apiVersion: '2',
                methods: [],
                missingMethods: [],
                error: null,
                recoverySteps: []
            }),
            printCapabilityMismatch: vi.fn(),
            formatSyncPolicyLabel: (policy) => String(policy ?? ''),
            formatDebugArtifactsLabel: (enabled) => enabled ? 'enabled' : 'disabled',
            printJsonOrValue: (_asJson, _value, render) => {
                render();
                return 0;
            },
            pruneHookDumps: vi.fn(() => ({
                rootDir: 'C:/tmp',
                maxAgeDays: 14,
                debugMaxAgeDays: 7,
                debugArtifactsEnabled: false,
                deletedFiles: 0,
                deletedDirs: 0,
                reclaimedBytes: 0,
                prunedPaths: []
            }))
        });

        const sendToDaemon = vi.spyOn(client, 'sendToDaemon').mockResolvedValue({
            workspaceResolved: true,
            syncPolicy: 'metadata_only',
            captureRetentionDays: 14,
            debugRetentionDays: 7,
            debugArtifactsEnabled: false,
            preset: 'lean'
        });

        const code = await commandDataPolicy('show', {});

        expect(code).toBe(0);
        expect(lines.some((line) => line.includes('Policy mode:') && line.includes('Lean (machine default)'))).toBe(true);
        expect(lines.some((line) => line.includes('Normal path:') && line.includes('workspace sync is metadata_only; machine defaults remain local'))).toBe(true);
        sendToDaemon.mockRestore();
        log.mockRestore();
    });

    it('keeps review/debug machine presets distinct from workspace sync wording', async () => {
        const lines: string[] = [];
        const log = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
            lines.push(String(value ?? ''));
        });

        const { commandDataPolicy } = createDataPolicyCommands({
            requireCommandContextId: async () => null,
            resolveCommandContextId: async () => 'ctx-1',
            parseOptionalStringFlag: (value) => typeof value === 'string' ? value : null,
            parseOptionalPositiveNumberFlag: () => null,
            parseOptionalBooleanLikeFlag: () => null,
            ensureDaemonCapabilities: async () => ({
                ok: true,
                reachable: true,
                apiVersion: '2',
                methods: [],
                missingMethods: [],
                error: null,
                recoverySteps: []
            }),
            printCapabilityMismatch: vi.fn(),
            formatSyncPolicyLabel: (policy) => String(policy ?? ''),
            formatDebugArtifactsLabel: (enabled) => enabled ? 'enabled' : 'disabled',
            printJsonOrValue: (_asJson, _value, render) => {
                render();
                return 0;
            },
            pruneHookDumps: vi.fn(() => ({
                rootDir: 'C:/tmp',
                maxAgeDays: 14,
                debugMaxAgeDays: 7,
                debugArtifactsEnabled: false,
                deletedFiles: 0,
                deletedDirs: 0,
                reclaimedBytes: 0,
                prunedPaths: []
            }))
        });

        const sendToDaemon = vi.spyOn(client, 'sendToDaemon').mockResolvedValue({
            workspaceResolved: true,
            syncPolicy: 'metadata_only',
            captureRetentionDays: 30,
            debugRetentionDays: 7,
            debugArtifactsEnabled: false,
            preset: 'review'
        });

        const code = await commandDataPolicy('show', {});

        expect(code).toBe(0);
        expect(lines.some((line) => line.includes('Policy mode:') && line.includes('Review (machine default)'))).toBe(true);
        expect(lines.some((line) => line.includes('Scope:') && line.includes('Machine capture and debug defaults come from the Review machine preset.'))).toBe(true);
        expect(lines.some((line) => line.includes('Next step:') && line.includes('Return this machine to Lean'))).toBe(true);
        sendToDaemon.mockRestore();
        log.mockRestore();
    });

    it('shows shared as a workspace override with full_sync opt-in in show output', async () => {
        const lines: string[] = [];
        const log = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
            lines.push(String(value ?? ''));
        });

        const { commandDataPolicy } = createDataPolicyCommands({
            requireCommandContextId: async () => null,
            resolveCommandContextId: async () => 'ctx-1',
            parseOptionalStringFlag: (value) => typeof value === 'string' ? value : null,
            parseOptionalPositiveNumberFlag: () => null,
            parseOptionalBooleanLikeFlag: () => null,
            ensureDaemonCapabilities: async () => ({
                ok: true,
                reachable: true,
                apiVersion: '2',
                methods: [],
                missingMethods: [],
                error: null,
                recoverySteps: []
            }),
            printCapabilityMismatch: vi.fn(),
            formatSyncPolicyLabel: (policy) => policy === 'full_sync' ? 'full_sync (opt-in)' : String(policy ?? ''),
            formatDebugArtifactsLabel: (enabled) => enabled ? 'enabled' : 'disabled',
            printJsonOrValue: (_asJson, _value, render) => {
                render();
                return 0;
            },
            pruneHookDumps: vi.fn(() => ({
                rootDir: 'C:/tmp',
                maxAgeDays: 14,
                debugMaxAgeDays: 7,
                debugArtifactsEnabled: false,
                deletedFiles: 0,
                deletedDirs: 0,
                reclaimedBytes: 0,
                prunedPaths: []
            }))
        });

        const sendToDaemon = vi.spyOn(client, 'sendToDaemon').mockResolvedValue({
            workspaceResolved: true,
            syncPolicy: 'full_sync',
            captureRetentionDays: 14,
            debugRetentionDays: 7,
            debugArtifactsEnabled: false,
            preset: 'shared'
        });

        const code = await commandDataPolicy('show', {});

        expect(code).toBe(0);
        expect(lines.some((line) => line.includes('Policy mode:') && line.includes('Shared (workspace override)'))).toBe(true);
        expect(lines.some((line) => line.includes('Workspace sync:') && line.includes('full_sync (opt-in)'))).toBe(true);
        expect(lines.some((line) => line.includes('Normal path:') && line.includes('richer cloud sync'))).toBe(true);
        sendToDaemon.mockRestore();
        log.mockRestore();
    });

    it('cleanup restores lean preset for a resolved workspace and prunes with returned retention policy', async () => {
        let captured: unknown = null;
        const pruneHookDumps = vi.fn(() => ({
            rootDir: 'C:/tmp',
            maxAgeDays: 14,
            debugMaxAgeDays: 7,
            debugArtifactsEnabled: false,
            deletedFiles: 3,
            deletedDirs: 1,
            reclaimedBytes: 512,
            prunedPaths: ['C:/tmp/file.json']
        }));
        const { commandDataPolicy } = createDataPolicyCommands({
            requireCommandContextId: async () => null,
            resolveCommandContextId: async () => 'ctx-1',
            parseOptionalStringFlag: (value) => typeof value === 'string' ? value : null,
            parseOptionalPositiveNumberFlag: () => null,
            parseOptionalBooleanLikeFlag: () => null,
            ensureDaemonCapabilities: async () => ({
                ok: true,
                reachable: true,
                apiVersion: '2',
                methods: [],
                missingMethods: [],
                error: null,
                recoverySteps: []
            }),
            printCapabilityMismatch: vi.fn(),
            formatSyncPolicyLabel: (policy) => String(policy ?? ''),
            formatDebugArtifactsLabel: (enabled) => enabled ? 'enabled' : 'disabled',
            printJsonOrValue: (_asJson, value) => {
                captured = value;
                return 0;
            },
            pruneHookDumps
        });
        const sendToDaemon = vi.spyOn(client, 'sendToDaemon').mockResolvedValue({
            contextId: 'ctx-1',
            workspaceResolved: true,
            syncPolicy: 'metadata_only',
            captureRetentionDays: 14,
            debugRetentionDays: 7,
            debugArtifactsEnabled: false,
            preset: 'lean'
        });

        const code = await commandDataPolicy('cleanup', { json: true });

        expect(code).toBe(0);
        expect(sendToDaemon).toHaveBeenCalledWith('setDataPolicy', { contextId: 'ctx-1', preset: 'lean' });
        expect(pruneHookDumps).toHaveBeenCalledWith({
            maxAgeDays: 14,
            debugMaxAgeDays: 7,
            debugArtifactsEnabled: false
        });
        expect(captured).toMatchObject({
            policy: {
                preset: 'lean',
                workspaceResolved: true
            },
            prune: {
                deletedFiles: 3,
                deletedDirs: 1
            }
        });
        sendToDaemon.mockRestore();
    });

    it('cleanup restores machine lean defaults without requiring a workspace', async () => {
        const pruneHookDumps = vi.fn(() => ({
            rootDir: 'C:/tmp',
            maxAgeDays: 14,
            debugMaxAgeDays: 7,
            debugArtifactsEnabled: false,
            deletedFiles: 0,
            deletedDirs: 0,
            reclaimedBytes: 0,
            prunedPaths: []
        }));
        const { commandDataPolicy } = createDataPolicyCommands({
            requireCommandContextId: async () => null,
            resolveCommandContextId: async () => null,
            parseOptionalStringFlag: (value) => typeof value === 'string' ? value : null,
            parseOptionalPositiveNumberFlag: () => null,
            parseOptionalBooleanLikeFlag: () => null,
            ensureDaemonCapabilities: async () => ({
                ok: true,
                reachable: true,
                apiVersion: '2',
                methods: [],
                missingMethods: [],
                error: null,
                recoverySteps: []
            }),
            printCapabilityMismatch: vi.fn(),
            formatSyncPolicyLabel: (policy) => String(policy ?? ''),
            formatDebugArtifactsLabel: (enabled) => enabled ? 'enabled' : 'disabled',
            printJsonOrValue: () => 0,
            pruneHookDumps
        });
        const sendToDaemon = vi.spyOn(client, 'sendToDaemon').mockResolvedValue({
            contextId: null,
            workspaceResolved: false,
            syncPolicy: 'metadata_only',
            captureRetentionDays: 14,
            debugRetentionDays: 7,
            debugArtifactsEnabled: false,
            preset: 'lean'
        });

        const code = await commandDataPolicy('cleanup', {});

        expect(code).toBe(0);
        expect(sendToDaemon).toHaveBeenCalledWith('setDataPolicy', {
            captureRetentionDays: 14,
            debugRetentionDays: 7,
            debugArtifactsEnabled: false
        });
        sendToDaemon.mockRestore();
    });

    it('requires explicit confirmation before enabling shared full_sync', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const sendToDaemon = vi.spyOn(client, 'sendToDaemon').mockResolvedValue({});
        const { commandDataPolicy } = createDataPolicyCommands({
            requireCommandContextId: async () => 'ctx-1',
            resolveCommandContextId: async () => 'ctx-1',
            parseOptionalStringFlag: (value) => typeof value === 'string' ? value : null,
            parseOptionalPositiveNumberFlag: () => null,
            parseOptionalBooleanLikeFlag: () => null,
            ensureDaemonCapabilities: async () => ({
                ok: true,
                reachable: true,
                apiVersion: '2',
                methods: [],
                missingMethods: [],
                error: null,
                recoverySteps: []
            }),
            printCapabilityMismatch: vi.fn(),
            formatSyncPolicyLabel: (policy) => String(policy ?? ''),
            formatDebugArtifactsLabel: (enabled) => enabled ? 'enabled' : 'disabled',
            printJsonOrValue: () => 0,
            pruneHookDumps: vi.fn(() => ({
                rootDir: 'C:/tmp',
                maxAgeDays: 14,
                debugMaxAgeDays: 7,
                debugArtifactsEnabled: false,
                deletedFiles: 0,
                deletedDirs: 0,
                reclaimedBytes: 0,
                prunedPaths: []
            }))
        });

        const code = await commandDataPolicy('shared', {});

        expect(code).toBe(1);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('--confirm-full-sync'));
        expect(sendToDaemon).not.toHaveBeenCalled();
        sendToDaemon.mockRestore();
        error.mockRestore();
    });
});
