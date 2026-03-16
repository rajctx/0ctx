import fs from 'fs';
import os from 'os';
import path from 'path';
import { type HookAgent, type HookConfigResult, type HookSupportedAgent } from './types';
import { isRecord, toStableJson } from './shared';

const CODEX_NOTIFY_BEGIN = '# BEGIN 0ctx-codex-notify';
const CODEX_NOTIFY_END = '# END 0ctx-codex-notify';

export function buildHookCommand(
    agent: HookSupportedAgent,
    _projectRoot: string,
    cliCommand: string,
    _contextId: string | null
): string {
    if (agent === 'codex') {
        return `${cliCommand} connector hook ingest --quiet --agent=codex --payload`;
    }
    return `${cliCommand} connector hook ingest --quiet --agent=${agent}`;
}

export function buildSessionStartCommand(
    agent: Extract<HookSupportedAgent, 'claude' | 'factory' | 'antigravity'>,
    cliCommand: string
): string {
    return `${cliCommand} connector hook session-start --agent=${agent}`;
}

function toTomlString(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildCodexNotifyBlock(_projectRoot: string, cliCommand: string, _contextId: string | null): string {
    const args = [cliCommand, 'connector', 'hook', 'ingest', '--agent=codex', '--payload'];
    const notifyLine = `notify = [${args.map(toTomlString).join(', ')}]`;
    return `${CODEX_NOTIFY_BEGIN}\n${notifyLine}\n${CODEX_NOTIFY_END}\n`;
}

export function ensureCodexNotifyConfig(options: {
    projectRoot: string;
    contextId: string | null;
    cliCommand: string;
    dryRun: boolean;
}): HookConfigResult {
    const configPath = path.join(options.projectRoot, '.codex', 'config.toml');
    const block = buildCodexNotifyBlock(options.projectRoot, options.cliCommand, options.contextId);
    const blockPattern = /# BEGIN 0ctx-codex-notify[\s\S]*?# END 0ctx-codex-notify\s*/m;
    const hasNotifyPattern = /^\s*notify\s*=/m;

    if (!fs.existsSync(configPath)) {
        if (!options.dryRun) {
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(configPath, block, 'utf8');
        }
        return { changed: !options.dryRun, configPath, configured: true, reason: null };
    }

    const current = fs.readFileSync(configPath, 'utf8');
    if (blockPattern.test(current)) {
        const next = current.replace(blockPattern, block);
        const changed = next !== current;
        if (changed && !options.dryRun) {
            fs.writeFileSync(configPath, next, 'utf8');
        }
        return { changed: changed && !options.dryRun, configPath, configured: true, reason: null };
    }

    if (hasNotifyPattern.test(current)) {
        return {
            changed: false,
            configPath,
            configured: false,
            reason: 'existing notify key found in .codex/config.toml (manual merge required)'
        };
    }

    const separator = current.endsWith('\n') ? '' : '\n';
    if (!options.dryRun) {
        fs.writeFileSync(configPath, `${current}${separator}${block}`, 'utf8');
    }
    return { changed: !options.dryRun, configPath, configured: true, reason: null };
}

export function readJsonConfig(configPath: string): {
    exists: boolean;
    value: Record<string, unknown> | null;
    reason: string | null;
} {
    if (!fs.existsSync(configPath)) {
        return { exists: false, value: null, reason: null };
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown;
        if (!isRecord(parsed)) {
            return { exists: true, value: null, reason: 'config file must be a JSON object' };
        }
        return { exists: true, value: parsed, reason: null };
    } catch (error) {
        return {
            exists: true,
            value: null,
            reason: `invalid JSON: ${error instanceof Error ? error.message : 'unknown parse error'}`
        };
    }
}

export function writeJsonConfig(configPath: string, value: Record<string, unknown>, dryRun: boolean): boolean {
    const next = toStableJson(value);
    const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : null;
    if (current === next) return false;
    if (!dryRun) {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, next, 'utf8');
    }
    return !dryRun;
}

export function isManagedHookCommand(command: unknown, agent: HookSupportedAgent): boolean {
    if (typeof command !== 'string') return false;
    if (!command.includes('0ctx connector hook ingest') && !command.includes('0ctx connector hook session-start')) {
        return false;
    }
    if (agent === 'factory') {
        return command.includes('--agent=factory') || command.includes('--agent=antigravity');
    }
    return command.includes(`--agent=${agent}`);
}

export function ensureHookEventArray(
    hooksRoot: Record<string, unknown>,
    eventName: string
): { hooks: unknown[] | null; reason: string | null } {
    const eventValue = hooksRoot[eventName];
    if (eventValue === undefined) return { hooks: [], reason: null };
    if (!Array.isArray(eventValue)) {
        return { hooks: null, reason: `hooks.${eventName} must be an array` };
    }
    return { hooks: eventValue, reason: null };
}

export function removeManagedHookCommandsFromConfig(options: {
    configPath: string;
    agent: HookSupportedAgent;
    events: string[];
    dryRun: boolean;
}): { changed: boolean; reason: string | null } {
    const read = readJsonConfig(options.configPath);
    if (!read.exists) return { changed: false, reason: null };
    if (read.reason || !read.value) {
        return { changed: false, reason: read.reason ?? 'config file must be a JSON object' };
    }

    const config = read.value;
    const hooksValue = config.hooks;
    if (hooksValue === undefined) return { changed: false, reason: null };
    if (!isRecord(hooksValue)) {
        return { changed: false, reason: 'hooks must be a JSON object' };
    }

    const hooksRoot = { ...hooksValue };
    let changed = false;
    for (const eventName of options.events) {
        const eventGroups = ensureHookEventArray(hooksRoot, eventName);
        if (eventGroups.reason) {
            return { changed: false, reason: eventGroups.reason };
        }

        const nextGroups: unknown[] = [];
        let eventChanged = false;
        for (const group of eventGroups.hooks ?? []) {
            if (!isRecord(group)) {
                nextGroups.push(group);
                continue;
            }
            const hookEntries = group.hooks;
            if (hookEntries === undefined) {
                nextGroups.push(group);
                continue;
            }
            if (!Array.isArray(hookEntries)) {
                return { changed: false, reason: `hooks.${eventName} entries must include a hooks array` };
            }
            const filteredEntries = hookEntries.filter((entry) => {
                if (!isRecord(entry) || entry.type !== 'command') return true;
                return !isManagedHookCommand(entry.command, options.agent);
            });
            if (filteredEntries.length !== hookEntries.length) {
                eventChanged = true;
            }
            if (filteredEntries.length === 0) {
                if (hookEntries.length > 0) eventChanged = true;
                continue;
            }
            nextGroups.push(filteredEntries.length === hookEntries.length ? group : { ...group, hooks: filteredEntries });
        }
        if (eventChanged) {
            hooksRoot[eventName] = nextGroups;
            changed = true;
        }
    }

    if (!changed) return { changed: false, reason: null };
    return { changed: writeJsonConfig(options.configPath, { ...config, hooks: hooksRoot }, options.dryRun), reason: null };
}

export function getClaudeProjectConfigPath(projectRoot: string): string {
    return path.join(projectRoot, '.claude', 'settings.local.json');
}

export function getClaudeGlobalConfigPath(): string {
    return path.join(os.homedir(), '.claude', 'settings.json');
}

export function getHookStatePath(): string {
    return process.env.CTX_HOOK_STATE_PATH || path.join(os.homedir(), '.0ctx', 'hooks-state.json');
}

export function getHookConfigPath(projectRoot: string, agent: HookAgent): string {
    switch (agent) {
        case 'claude':
            return path.join(projectRoot, '.claude', 'settings.local.json');
        case 'windsurf':
            return path.join(projectRoot, '.windsurf', 'hooks.json');
        case 'cursor':
            return path.join(projectRoot, '.cursor', 'hooks.json');
        case 'factory':
            return path.join(projectRoot, '.factory', 'settings.json');
        case 'antigravity':
            return path.join(projectRoot, '.gemini', 'settings.json');
        case 'codex':
            return path.join(projectRoot, '.codex', 'config.toml');
        default:
            return path.join(projectRoot, '.0ctx', 'settings.local.json');
    }
}
