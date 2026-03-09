import type { HookCommandDeps, FlagMap } from './types';

export function createHookInstallCommand(deps: HookCommandDeps) {
    return async function commandHookInstall(flags: FlagMap): Promise<number> {
        const asJson = Boolean(flags.json);
        const quiet = Boolean(flags.quiet) || asJson;
        const dryRun = Boolean(flags['dry-run']) || Boolean(flags['hooks-dry-run']);
        const installClaudeGlobal = Boolean(flags.global);
        const repoRoot = deps.resolveRepoRoot(deps.parseOptionalStringFlag(flags['repo-root']));
        const requestedContextId = deps.parseOptionalStringFlag(flags['context-id'] ?? flags.contextId);
        const contextId = await deps.resolveContextIdForHookIngest(repoRoot, requestedContextId);
        const previewError = deps.validateExplicitPreviewSelection(flags.clients, 'codex,cursor,windsurf');
        if (previewError) {
            console.error(previewError);
            return 1;
        }

        const selectedClients = deps.parseHookClients(flags.clients).map(client => client.toLowerCase());
        const selectedClientSet = new Set(selectedClients);

        const result = deps.installHooks({
            projectRoot: repoRoot,
            contextId,
            clients: selectedClients,
            dryRun,
            cliCommand: '0ctx',
            installClaudeGlobal
        });

        if (asJson) {
            console.log(JSON.stringify({
                ok: true,
                dryRun: result.dryRun,
                changed: result.changed,
                projectRoot: result.projectRoot,
                contextId: result.contextId,
                projectConfigPath: result.projectConfigPath,
                statePath: result.statePath,
                claudeConfigPath: result.claudeConfigPath,
                claudeHookConfigured: result.claudeHookConfigured,
                claudeHookReason: result.claudeHookReason,
                claudeGlobalConfigPath: result.claudeGlobalConfigPath,
                claudeGlobalHookConfigured: result.claudeGlobalHookConfigured,
                claudeGlobalHookReason: result.claudeGlobalHookReason,
                windsurfConfigPath: result.windsurfConfigPath,
                windsurfHookConfigured: result.windsurfHookConfigured,
                windsurfHookReason: result.windsurfHookReason,
                cursorConfigPath: result.cursorConfigPath,
                cursorHookConfigured: result.cursorHookConfigured,
                cursorHookReason: result.cursorHookReason,
                factoryConfigPath: result.factoryConfigPath,
                factoryHookConfigured: result.factoryHookConfigured,
                factoryHookReason: result.factoryHookReason,
                antigravityConfigPath: result.antigravityConfigPath,
                antigravityHookConfigured: result.antigravityHookConfigured,
                antigravityHookReason: result.antigravityHookReason,
                codexConfigPath: result.codexConfigPath,
                codexNotifyConfigured: result.codexNotifyConfigured,
                codexNotifyReason: result.codexNotifyReason,
                warnings: result.warnings,
                selectedClients,
                agents: result.state.agents
            }, null, 2));
            return 0;
        }

        if (!quiet) {
            console.log(`hook_install: ${dryRun ? 'dry-run' : (result.changed ? 'updated' : 'already up-to-date')}`);
            console.log(`project_root: ${result.projectRoot}`);
            console.log(`context_id: ${result.contextId ?? 'n/a (repo path will resolve at capture time)'}`);
            console.log(`project_config: ${result.projectConfigPath}`);
            console.log(`state_path: ${result.statePath}`);
            if (selectedClientSet.has('claude')) {
                console.log(`claude_config: ${result.claudeConfigPath}`);
                console.log(`claude_hook: ${result.claudeHookConfigured ? 'configured' : `not-configured (${result.claudeHookReason ?? 'unknown'})`}`);
            }
            if (selectedClientSet.has('claude') && (installClaudeGlobal || result.claudeGlobalHookConfigured)) {
                console.log(`claude_global_config: ${result.claudeGlobalConfigPath}`);
                console.log(`claude_global_hook: ${result.claudeGlobalHookConfigured ? 'configured' : `not-configured (${result.claudeGlobalHookReason ?? 'unknown'})`}`);
            }
            if (selectedClientSet.has('factory')) {
                console.log(`factory_config: ${result.factoryConfigPath}`);
                console.log(`factory_hook: ${result.factoryHookConfigured ? 'configured' : `not-configured (${result.factoryHookReason ?? 'unknown'})`}`);
            }
            if (selectedClientSet.has('antigravity')) {
                console.log(`antigravity_config: ${result.antigravityConfigPath}`);
                console.log(`antigravity_hook: ${result.antigravityHookConfigured ? 'configured' : `not-configured (${result.antigravityHookReason ?? 'unknown'})`}`);
            }
            if (selectedClientSet.has('codex')) {
                console.log(`codex_config: ${result.codexConfigPath}`);
                console.log(`codex_notify: ${result.codexNotifyConfigured ? 'configured' : `not-configured (${result.codexNotifyReason ?? 'unknown'})`}`);
            }
            if (selectedClientSet.has('cursor')) {
                console.log(`cursor_config: ${result.cursorConfigPath}`);
                console.log(`cursor_hook: ${result.cursorHookConfigured ? 'configured' : `not-configured (${result.cursorHookReason ?? 'unknown'})`}`);
            }
            if (selectedClientSet.has('windsurf')) {
                console.log(`windsurf_config: ${result.windsurfConfigPath}`);
                console.log(`windsurf_hook: ${result.windsurfHookConfigured ? 'configured' : `not-configured (${result.windsurfHookReason ?? 'unknown'})`}`);
            }
            for (const agent of result.state.agents.filter(agent => selectedClientSet.has(agent.agent))) {
                console.log(`agent_${agent.agent}: ${agent.status}${agent.installed ? ' (installed)' : ''}`);
            }
            for (const warning of result.warnings) console.log(`warning: ${warning}`);
        }
        return 0;
    };
}
