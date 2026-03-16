import fs from 'fs';
import path from 'path';
import { buildHookCommand, ensureCodexNotifyConfig, getClaudeGlobalConfigPath, getClaudeProjectConfigPath, getHookStatePath } from './config';
import { ensureClaudeHookConfig } from './install-claude';
import { ensureAntigravityHookConfig, ensureFactoryHookConfig } from './install-managed';
import { ensureCursorHookConfig, ensureWindsurfHookConfig } from './install-simple';
import { defaultHookAgents, normalizeClient, toStableJson, writeIfChanged } from './shared';
import { buildHookProjectConfig, readHookInstallState } from './state';
import { type HookAgent, type HookAgentState, type HookConfigResult, type HookInstallResult, type HookSupportedAgent, PREVIEW_HOOK_AGENTS } from './types';

export function installHooks(options: {
    projectRoot: string;
    contextId?: string | null;
    clients: string[];
    dryRun?: boolean;
    now?: number;
    cliCommand?: string;
    installClaudeGlobal?: boolean;
}): HookInstallResult {
    const now = options.now ?? Date.now();
    const projectRoot = path.resolve(options.projectRoot);
    const projectConfigPath = path.join(projectRoot, '.0ctx', 'settings.local.json');
    const statePath = getHookStatePath();
    const dryRun = options.dryRun === true;
    const cliCommand = options.cliCommand ?? '0ctx';
    const contextId = options.contextId ?? null;
    const installClaudeGlobal = options.installClaudeGlobal === true;
    const existingState = fs.existsSync(statePath) ? readHookInstallState(now) : null;

    const selectedClients = new Set<HookAgent>();
    for (const client of options.clients) {
        const normalized = normalizeClient(client);
        if (normalized) selectedClients.add(normalized);
    }

    const claudeHook = selectedClients.has('claude')
        ? ensureClaudeHookConfig({ configPath: getClaudeProjectConfigPath(projectRoot), contextId, cliCommand, dryRun })
        : { changed: false, configPath: getClaudeProjectConfigPath(projectRoot), configured: false, reason: 'claude-not-selected' };
    const claudeGlobalHook = selectedClients.has('claude') && installClaudeGlobal
        ? ensureClaudeHookConfig({ configPath: getClaudeGlobalConfigPath(), contextId: null, cliCommand, dryRun })
        : {
            changed: false,
            configPath: getClaudeGlobalConfigPath(),
            configured: false,
            reason: installClaudeGlobal ? 'claude-not-selected' : 'claude-global-not-selected'
        };
    const windsurfHook = selectedClients.has('windsurf')
        ? ensureWindsurfHookConfig({ projectRoot, contextId, cliCommand, dryRun })
        : { changed: false, configPath: path.join(projectRoot, '.windsurf', 'hooks.json'), configured: false, reason: 'windsurf-not-selected' };
    const cursorHook = selectedClients.has('cursor')
        ? ensureCursorHookConfig({ projectRoot, contextId, cliCommand, dryRun })
        : { changed: false, configPath: path.join(projectRoot, '.cursor', 'hooks.json'), configured: false, reason: 'cursor-not-selected' };
    const factoryHook = selectedClients.has('factory')
        ? ensureFactoryHookConfig({ projectRoot, contextId, cliCommand, dryRun })
        : { changed: false, configPath: path.join(projectRoot, '.factory', 'settings.json'), configured: false, reason: 'factory-not-selected' };
    const antigravityHook = selectedClients.has('antigravity')
        ? ensureAntigravityHookConfig({ projectRoot, contextId, cliCommand, dryRun })
        : { changed: false, configPath: path.join(projectRoot, '.gemini', 'settings.json'), configured: false, reason: 'antigravity-not-selected' };
    const codexNotify = selectedClients.has('codex')
        ? ensureCodexNotifyConfig({ projectRoot, contextId, cliCommand, dryRun })
        : { changed: false, configPath: path.join(projectRoot, '.codex', 'config.toml'), configured: false, reason: 'codex-not-selected' };

    const hookConfigsByAgent: Record<HookSupportedAgent, HookConfigResult> = {
        claude: claudeHook,
        windsurf: windsurfHook,
        cursor: cursorHook,
        factory: factoryHook,
        antigravity: antigravityHook,
        codex: codexNotify
    };
    const warnings = collectInstallWarnings(selectedClients, installClaudeGlobal, {
        claudeHook,
        claudeGlobalHook,
        windsurfHook,
        cursorHook,
        factoryHook,
        antigravityHook,
        codexNotify
    });

    const agents = readInstalledAgents({
        now,
        existingState,
        selectedClients,
        hookConfigsByAgent,
        projectRoot,
        contextId,
        cliCommand
    });
    const stateChanged = existingState
        ? existingState.projectRoot !== projectRoot
            || existingState.contextId !== contextId
            || existingState.projectConfigPath !== projectConfigPath
            || JSON.stringify(existingState.agents) !== JSON.stringify(agents)
        : true;
    const state = {
        version: 1 as const,
        updatedAt: stateChanged ? now : (existingState?.updatedAt ?? now),
        projectRoot,
        contextId,
        projectConfigPath,
        agents
    };

    let changed = false;
    if (!dryRun) {
        const persistedStateChanged = writeIfChanged(statePath, toStableJson(state));
        const projectConfigChanged = writeIfChanged(projectConfigPath, toStableJson(buildHookProjectConfig(state)));
        changed = persistedStateChanged
            || projectConfigChanged
            || claudeHook.changed
            || claudeGlobalHook.changed
            || windsurfHook.changed
            || cursorHook.changed
            || factoryHook.changed
            || antigravityHook.changed
            || codexNotify.changed;
    }

    return {
        changed,
        dryRun,
        statePath,
        projectRoot,
        contextId,
        projectConfigPath,
        claudeConfigPath: claudeHook.configPath,
        claudeHookConfigured: claudeHook.configured,
        claudeHookReason: claudeHook.reason,
        claudeGlobalConfigPath: claudeGlobalHook.configPath,
        claudeGlobalHookConfigured: claudeGlobalHook.configured,
        claudeGlobalHookReason: claudeGlobalHook.reason,
        windsurfConfigPath: windsurfHook.configPath,
        windsurfHookConfigured: windsurfHook.configured,
        windsurfHookReason: windsurfHook.reason,
        cursorConfigPath: cursorHook.configPath,
        cursorHookConfigured: cursorHook.configured,
        cursorHookReason: cursorHook.reason,
        factoryConfigPath: factoryHook.configPath,
        factoryHookConfigured: factoryHook.configured,
        factoryHookReason: factoryHook.reason,
        antigravityConfigPath: antigravityHook.configPath,
        antigravityHookConfigured: antigravityHook.configured,
        antigravityHookReason: antigravityHook.reason,
        codexConfigPath: codexNotify.configPath,
        codexNotifyConfigured: codexNotify.configured,
        codexNotifyReason: codexNotify.reason,
        warnings,
        state
    };
}

function collectInstallWarnings(
    selectedClients: Set<HookAgent>,
    installClaudeGlobal: boolean,
    results: Record<string, HookConfigResult>
): string[] {
    const warnings: string[] = [];
    if (selectedClients.has('claude') && !results.claudeHook.configured) {
        warnings.push(`Claude hook was not configured: ${results.claudeHook.reason ?? 'unknown reason'}.`);
    }
    if (selectedClients.has('claude') && installClaudeGlobal && !results.claudeGlobalHook.configured) {
        warnings.push(`Claude global hook was not configured: ${results.claudeGlobalHook.reason ?? 'unknown reason'}.`);
    }
    if (selectedClients.has('windsurf') && !results.windsurfHook.configured) {
        warnings.push(`Windsurf hook was not configured: ${results.windsurfHook.reason ?? 'unknown reason'}.`);
    } else if (selectedClients.has('windsurf') && results.windsurfHook.configured) {
        warnings.push('Windsurf capture is explicit opt-in: hooks are installed, but 0ctx does not treat Windsurf as GA yet.');
    }
    if (selectedClients.has('cursor') && !results.cursorHook.configured) {
        warnings.push(`Cursor hook was not configured: ${results.cursorHook.reason ?? 'unknown reason'}.`);
    } else if (selectedClients.has('cursor') && results.cursorHook.configured) {
        warnings.push('Cursor capture is explicit opt-in: hooks are installed, but 0ctx does not treat Cursor as GA yet.');
    }
    if (selectedClients.has('factory') && !results.factoryHook.configured) {
        warnings.push(`Factory hook was not configured: ${results.factoryHook.reason ?? 'unknown reason'}.`);
    }
    if (selectedClients.has('antigravity') && !results.antigravityHook.configured) {
        warnings.push(`Antigravity hook was not configured: ${results.antigravityHook.reason ?? 'unknown reason'}.`);
    }
    if (selectedClients.has('codex') && !results.codexNotify.configured) {
        warnings.push(`Codex notify was not configured: ${results.codexNotify.reason ?? 'unknown reason'}.`);
    } else if (selectedClients.has('codex') && results.codexNotify.configured) {
        warnings.push('Codex capture is explicit opt-in: notify triggers ingestion, and 0ctx reconstructs sessions from the local Codex archive.');
    }
    return warnings;
}

function readInstalledAgents(options: {
    now: number;
    existingState: { agents: HookAgentState[] } | null;
    selectedClients: Set<HookAgent>;
    hookConfigsByAgent: Record<HookSupportedAgent, HookConfigResult>;
    projectRoot: string;
    contextId: string | null;
    cliCommand: string;
}): HookAgentState[] {
    return defaultHookAgents(options.now).map((agent): HookAgentState => {
        const previous = options.existingState?.agents.find((item) => item.agent === agent.agent);
        const supportedAgent = agent.agent as HookSupportedAgent;
        const selected = options.selectedClients.has(supportedAgent);
        const installResult = options.hookConfigsByAgent[supportedAgent];
        const installed = selected && installResult.configured;
        const nextStatus: HookAgentState['status'] = installed ? 'Supported' : 'Skipped';
        const nextCommand = installed
            ? buildHookCommand(supportedAgent, options.projectRoot, options.cliCommand, options.contextId)
            : null;
        const nextNotes = !selected
            ? (PREVIEW_HOOK_AGENTS.has(supportedAgent) ? 'preview-not-selected' : 'not-selected')
            : installed
                ? (PREVIEW_HOOK_AGENTS.has(supportedAgent) ? 'preview-installed' : 'installed')
                : `not-installed: ${installResult.reason ?? 'hook-config-failed'}`;
        const unchanged = previous
            && previous.status === nextStatus
            && previous.installed === installed
            && previous.command === nextCommand
            && previous.notes === nextNotes;
        return {
            ...agent,
            status: nextStatus,
            installed,
            command: nextCommand,
            updatedAt: unchanged ? previous.updatedAt : options.now,
            notes: nextNotes
        };
    });
}
