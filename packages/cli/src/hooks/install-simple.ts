import path from 'path';
import { buildHookCommand, ensureHookEventArray, readJsonConfig, writeJsonConfig } from './config';
import { isRecord } from './shared';
import { type HookConfigResult, type HookSupportedAgent } from './types';

function ensureSimpleEventHookConfig(options: {
    projectRoot: string;
    contextId: string | null;
    cliCommand: string;
    dryRun: boolean;
    agent: HookSupportedAgent;
    configPath: string;
    eventName: string;
    ensureVersion?: boolean;
}): HookConfigResult {
    const command = buildHookCommand(options.agent, options.projectRoot, options.cliCommand, options.contextId);
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
    const eventEntries = ensureHookEventArray(hooksRoot, options.eventName);
    if (eventEntries.reason) {
        return { changed: false, configPath: options.configPath, configured: false, reason: eventEntries.reason };
    }

    const filteredEntries = (eventEntries.hooks ?? []).filter((entry) => !isRecord(entry) || !String(entry.command ?? '').includes(`--agent=${options.agent}`));
    filteredEntries.push({ command });
    hooksRoot[options.eventName] = filteredEntries;
    config.hooks = hooksRoot;
    if (options.ensureVersion && typeof config.version !== 'number') {
        config.version = 1;
    }

    return {
        changed: writeJsonConfig(options.configPath, config, options.dryRun),
        configPath: options.configPath,
        configured: true,
        reason: null
    };
}

export function ensureWindsurfHookConfig(options: {
    projectRoot: string;
    contextId: string | null;
    cliCommand: string;
    dryRun: boolean;
}): HookConfigResult {
    const configPath = path.join(options.projectRoot, '.windsurf', 'hooks.json');
    const responseHook = ensureSimpleEventHookConfig({ ...options, agent: 'windsurf', configPath, eventName: 'post_cascade_response' });
    if (!responseHook.configured) {
        return responseHook;
    }
    const promptHook = ensureSimpleEventHookConfig({ ...options, agent: 'windsurf', configPath, eventName: 'pre_user_prompt' });
    return {
        changed: responseHook.changed || promptHook.changed,
        configPath,
        configured: responseHook.configured && promptHook.configured,
        reason: responseHook.reason ?? promptHook.reason
    };
}

export function ensureCursorHookConfig(options: {
    projectRoot: string;
    contextId: string | null;
    cliCommand: string;
    dryRun: boolean;
}): HookConfigResult {
    return ensureSimpleEventHookConfig({
        ...options,
        agent: 'cursor',
        configPath: path.join(options.projectRoot, '.cursor', 'hooks.json'),
        eventName: 'afterAgentResponse',
        ensureVersion: true
    });
}
