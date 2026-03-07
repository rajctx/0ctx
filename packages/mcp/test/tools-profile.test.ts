import { describe, expect, it } from 'vitest';
import {
    getToolsForProfile,
    isToolEnabledForProfile,
    resolveMcpToolProfile
} from '../src/tools';

describe('MCP tool profile resolution', () => {
    it('defaults to all tools when profile is unset', () => {
        const resolved = resolveMcpToolProfile(undefined);
        expect(resolved.all).toBe(true);
        expect(resolved.normalized).toBe('all');
    });

    it('expands recall profile to include core scope', () => {
        const resolved = resolveMcpToolProfile('recall');
        expect(resolved.all).toBe(false);
        expect(resolved.profiles).toEqual(['recall']);
        expect(resolved.scopes).toContain('core');
        expect(resolved.scopes).toContain('recall');
    });

    it('falls back to all for invalid profile tokens', () => {
        const resolved = resolveMcpToolProfile('bad-token');
        expect(resolved.all).toBe(true);
        expect(resolved.invalidTokens).toEqual(['bad-token']);
    });
});

describe('MCP tool profile filtering', () => {
    it('core profile excludes recall and ops tools', () => {
        const tools = getToolsForProfile('core');
        const names = new Set(tools.map(tool => tool.name));
        expect(names.has('ctx_set')).toBe(true);
        expect(names.has('ctx_runtime_status')).toBe(true);
        expect(names.has('ctx_list_workstreams')).toBe(true);
        expect(names.has('ctx_get_workstream_brief')).toBe(true);
        expect(names.has('ctx_get_session')).toBe(true);
        expect(names.has('ctx_create_session_checkpoint')).toBe(true);
        expect(names.has('ctx_preview_insights')).toBe(true);
        expect(names.has('ctx_recall')).toBe(false);
        expect(names.has('ctx_sync_now')).toBe(false);
    });

    it('ops profile includes core and ops tools but excludes recall-only tools', () => {
        const tools = getToolsForProfile('ops');
        const names = new Set(tools.map(tool => tool.name));
        expect(names.has('ctx_set')).toBe(true);
        expect(names.has('ctx_sync_now')).toBe(true);
        expect(names.has('ctx_recall')).toBe(false);
    });

    it('isToolEnabledForProfile respects disabled tool scopes', () => {
        expect(isToolEnabledForProfile('ctx_recall', 'core')).toBe(false);
        expect(isToolEnabledForProfile('ctx_recall', 'recall')).toBe(true);
        expect(isToolEnabledForProfile('ctx_sync_now', 'ops')).toBe(true);
    });
});
