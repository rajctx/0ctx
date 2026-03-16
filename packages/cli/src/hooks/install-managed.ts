import os from 'os';
import path from 'path';
import { buildHookCommand, buildSessionStartCommand, ensureHookEventArray, isManagedHookCommand, readJsonConfig, removeManagedHookCommandsFromConfig, writeJsonConfig } from './config';
import { isRecord } from './shared';
import { type HookConfigResult, type HookSupportedAgent } from './types';

function ensureManagedHookConfig(options: {
    projectRoot: string;
    contextId: string | null;
    cliCommand: string;
    dryRun: boolean;
    agent: Extract<HookSupportedAgent, 'factory' | 'antigravity'>;
    configPath: string;
    includeMatcher: boolean;
    cleanupTargets: string[];
}): HookConfigResult {
    const captureCommand = buildHookCommand(options.agent, options.projectRoot, options.cliCommand, options.contextId);
    const sessionStartCommand = buildSessionStartCommand(options.agent, options.cliCommand);
    const read = readJsonConfig(options.configPath);
    const config: Record<string, unknown> = read.value ?? {};
    if (read.reason) {
        return { changed: false, configPath: options.configPath, configured: false, reason: read.reason };
    }

    const hooksValue = config.hooks;
    if (hooksValue !== undefined && !isRecord(hooksValue)) {
        return { changed: false, configPath: options.configPath, configured: false, reason: 'hooks must be a JSON object' };
    }

    const hooksRoot = (hooksValue ?? {}) as Record<string, unknown>;
    const eventCommands: Array<readonly [string, string]> = [
        ['SessionStart', sessionStartCommand],
        ['Stop', captureCommand],
        ['SubagentStop', captureCommand]
    ];
    for (const [eventName, command] of eventCommands) {
        const eventGroups = ensureHookEventArray(hooksRoot, eventName);
        if (eventGroups.reason) {
            return { changed: false, configPath: options.configPath, configured: false, reason: eventGroups.reason };
        }

        const nextEventGroups: unknown[] = [];
        for (const group of eventGroups.hooks ?? []) {
            if (!isRecord(group)) {
                nextEventGroups.push(group);
                continue;
            }
            const hookEntries = group.hooks;
            if (hookEntries === undefined) {
                nextEventGroups.push(group);
                continue;
            }
            if (!Array.isArray(hookEntries)) {
                return {
                    changed: false,
                    configPath: options.configPath,
                    configured: false,
                    reason: `hooks.${eventName} entries must include a hooks array`
                };
            }
            const filteredEntries = hookEntries.filter((entry) => {
                if (!isRecord(entry) || entry.type !== 'command') return true;
                return !isManagedHookCommand(entry.command, options.agent);
            });
            if (filteredEntries.length > 0) {
                nextEventGroups.push({ ...group, hooks: filteredEntries });
            }
        }

        nextEventGroups.push(options.includeMatcher
            ? {
                matcher: '*',
                hooks: [{ type: 'command', command }]
            }
            : {
                hooks: [{ type: 'command', command }]
            });
        hooksRoot[eventName] = nextEventGroups;
    }

    config.hooks = hooksRoot;
    const primaryChanged = writeJsonConfig(options.configPath, config, options.dryRun);
    let cleanupChanged = false;
    for (const cleanupPath of options.cleanupTargets.filter((candidate) => path.resolve(candidate) !== path.resolve(options.configPath))) {
        const cleanup = removeManagedHookCommandsFromConfig({
            configPath: cleanupPath,
            agent: options.agent,
            events: ['SessionStart', 'Stop', 'SubagentStop'],
            dryRun: options.dryRun
        });
        cleanupChanged = cleanupChanged || cleanup.changed;
    }

    return {
        changed: primaryChanged || cleanupChanged,
        configPath: options.configPath,
        configured: true,
        reason: null
    };
}

export function ensureFactoryHookConfig(options: {
    projectRoot: string;
    contextId: string | null;
    cliCommand: string;
    dryRun: boolean;
}): HookConfigResult {
    return ensureManagedHookConfig({
        ...options,
        agent: 'factory',
        configPath: path.join(options.projectRoot, '.factory', 'settings.json'),
        includeMatcher: false,
        cleanupTargets: [
            path.join(options.projectRoot, '.factory', 'settings.local.json'),
            path.join(os.homedir(), '.factory', 'settings.json'),
            path.join(os.homedir(), '.factory', 'settings.local.json')
        ]
    });
}

export function ensureAntigravityHookConfig(options: {
    projectRoot: string;
    contextId: string | null;
    cliCommand: string;
    dryRun: boolean;
}): HookConfigResult {
    return ensureManagedHookConfig({
        ...options,
        agent: 'antigravity',
        configPath: path.join(options.projectRoot, '.gemini', 'settings.json'),
        includeMatcher: true,
        cleanupTargets: [
            path.join(options.projectRoot, '.gemini', 'settings.local.json'),
            path.join(os.homedir(), '.gemini', 'settings.json'),
            path.join(os.homedir(), '.gemini', 'settings.local.json')
        ]
    });
}
