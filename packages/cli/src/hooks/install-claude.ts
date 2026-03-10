import { buildHookCommand, buildSessionStartCommand, ensureHookEventArray, isManagedHookCommand, readJsonConfig, writeJsonConfig } from './config';
import { isRecord } from './shared';
import { type HookConfigResult } from './types';

export function ensureClaudeHookConfig(options: {
    configPath: string;
    contextId: string | null;
    cliCommand: string;
    dryRun: boolean;
}): HookConfigResult {
    const captureCommand = buildHookCommand('claude', process.cwd(), options.cliCommand, options.contextId);
    const sessionStartCommand = buildSessionStartCommand('claude', options.cliCommand);
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
                return !isManagedHookCommand(entry.command, 'claude');
            });
            if (filteredEntries.length > 0) {
                nextEventGroups.push({ ...group, hooks: filteredEntries });
            }
        }

        nextEventGroups.push({
            hooks: [
                {
                    type: 'command',
                    command
                }
            ]
        });
        hooksRoot[eventName] = nextEventGroups;
    }

    config.hooks = hooksRoot;
    return {
        changed: writeJsonConfig(options.configPath, config, options.dryRun),
        configPath: options.configPath,
        configured: true,
        reason: null
    };
}
