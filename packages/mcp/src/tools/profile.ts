import { TOOL_SCOPE_BY_NAME, tools } from './groups';
import type { McpToolDefinition, ResolvedMcpToolProfile, ToolScope } from './types';

const ALL_TOOL_SCOPES: ToolScope[] = ['core', 'recall', 'ops'];

const PROFILE_SCOPE_EXPANSION: Record<ToolScope, ToolScope[]> = {
    core: ['core'],
    recall: ['core', 'recall'],
    ops: ['core', 'ops']
};

export function resolveMcpToolProfile(raw: string | null | undefined): ResolvedMcpToolProfile {
    const requested = (raw ?? '').trim();
    if (requested.length === 0) {
        return { requested: 'all', all: true, profiles: [], scopes: [...ALL_TOOL_SCOPES], normalized: 'all', invalidTokens: [] };
    }

    const tokens = requested
        .split(',')
        .map(token => token.trim().toLowerCase())
        .filter(token => token.length > 0);

    const profiles = new Set<ToolScope>();
    const scopes = new Set<ToolScope>();
    const invalidTokens: string[] = [];
    let all = false;

    for (const token of tokens) {
        if (token === 'all') {
            all = true;
            continue;
        }
        if (token === 'core' || token === 'recall' || token === 'ops') {
            profiles.add(token);
            for (const scope of PROFILE_SCOPE_EXPANSION[token]) scopes.add(scope);
            continue;
        }
        invalidTokens.push(token);
    }

    if (all || profiles.size === 0) {
        return {
            requested,
            all: true,
            profiles: [],
            scopes: [...ALL_TOOL_SCOPES],
            normalized: 'all',
            invalidTokens
        };
    }

    const normalizedProfiles = Array.from(profiles).sort();
    return {
        requested,
        all: false,
        profiles: normalizedProfiles,
        scopes: Array.from(scopes).sort(),
        normalized: normalizedProfiles.join(','),
        invalidTokens
    };
}

function toResolvedProfile(profile: ResolvedMcpToolProfile | string | null | undefined): ResolvedMcpToolProfile {
    return typeof profile === 'string' || profile === null || profile === undefined
        ? resolveMcpToolProfile(profile)
        : profile;
}

export function isToolEnabledForProfile(
    toolName: string,
    profile: ResolvedMcpToolProfile | string | null | undefined
): boolean {
    const resolved = toResolvedProfile(profile);
    if (resolved.all) return true;
    const scope = TOOL_SCOPE_BY_NAME[toolName] ?? 'core';
    return resolved.scopes.includes(scope);
}

export function getToolsForProfile(profile: ResolvedMcpToolProfile | string | null | undefined): McpToolDefinition[] {
    const resolved = toResolvedProfile(profile);
    return resolved.all ? [...tools] : tools.filter(tool => isToolEnabledForProfile(tool.name, resolved));
}
