import path from 'path';
import color from 'picocolors';
import type { ProductCommandDeps, FlagMap, CheckStatus, BootstrapResult } from './types';

export function createEnableCommands(deps: ProductCommandDeps & { commandBootstrap: (flags: FlagMap) => Promise<number> }) {
    async function commandInstall(flags: FlagMap): Promise<number> {
        const p = await import('@clack/prompts');
        const quiet = Boolean(flags.quiet);
        const asJson = Boolean(flags.json);
        const skipBootstrap = Boolean(flags['skip-bootstrap']);
        const previewError = deps.validateExplicitPreviewSelection(flags.clients, 'codex,cursor,windsurf');
        if (previewError) {
            console.error(previewError);
            return 1;
        }

        if (!quiet && !asJson) p.intro(color.bgBlue(color.black(' 0ctx install ')));
        const spinner = p.spinner();
        if (!quiet && !asJson) spinner.start('Checking daemon status');

        const daemonStatus = await deps.isDaemonReachable();
        if (!daemonStatus.ok) {
            if (!quiet && !asJson) spinner.message('Starting background service...');
            try {
                deps.startDaemonDetached();
            } catch (error) {
                if (!quiet && !asJson) spinner.stop(color.red('Failed to start daemon'));
                console.error(error instanceof Error ? error.message : String(error));
                if (!quiet && !asJson) p.outro(color.red('Install failed'));
                return 1;
            }
        }

        if (!quiet && !asJson) spinner.message('Waiting for daemon to become ready...');
        const ready = await deps.waitForDaemon();
        if (!ready) {
            if (!quiet && !asJson) spinner.stop(color.red('Daemon start timeout'));
            console.error('Unable to reach daemon health endpoint.');
            if (!quiet && !asJson) p.outro(color.red('Install failed'));
            return 1;
        }

        if (!quiet && !asJson) spinner.stop(color.green('Daemon is ready'));

        if (!skipBootstrap) {
            const bootstrapCode = await deps.commandBootstrap({ ...flags, quiet: (quiet || asJson), json: false });
            if (bootstrapCode !== 0) {
                if (!quiet && !asJson) p.outro(color.yellow('Install partial (bootstrap failed)'));
                return bootstrapCode;
            }
        }

        if (quiet || asJson) {
            if (asJson) {
                console.log(JSON.stringify({ ok: true, daemonRunning: true, bootstrap: skipBootstrap ? 'skipped' : 'ok' }, null, 2));
            }
            return 0;
        }

        const checks = await deps.isDaemonReachable();
        p.outro(color.green(`Installation complete! Daemon is ${checks.ok ? 'running' : 'degraded'}.`));
        return checks.ok ? 0 : 1;
    }

    async function commandEnable(flags: FlagMap): Promise<number> {
        const quiet = Boolean(flags.quiet);
        const asJson = Boolean(flags.json);
        const skipBootstrap = Boolean(flags['skip-bootstrap']);
        const skipHooks = Boolean(flags['skip-hooks']);
        const repoRoot = deps.resolveRepoRoot(deps.parseOptionalStringFlag(flags['repo-root'] ?? flags.repoRoot));
        const requestedName = deps.parseOptionalStringFlag(flags.name ?? flags['workspace-name'] ?? flags.workspaceName);
        const workspaceName = requestedName ?? (path.basename(repoRoot) || 'Workspace');
        const hookPreviewError = deps.validateExplicitPreviewSelection(flags.clients, 'codex,cursor,windsurf');
        if (hookPreviewError) {
            console.error(hookPreviewError);
            return 1;
        }
        const mcpPreviewError = deps.validateExplicitPreviewSelection(flags['mcp-clients'] ?? flags.mcpClients, 'codex', 'claude,antigravity');
        if (mcpPreviewError) {
            console.error(`MCP clients: ${mcpPreviewError}`);
            return 1;
        }

        const hookClients = deps.parseHookClients(flags.clients);
        const mcpClients = deps.parseEnableMcpClients(flags['mcp-clients'] ?? flags.mcpClients);
        const mcpProfile = deps.parseOptionalStringFlag(flags['mcp-profile'] ?? flags.profile) ?? 'core';
        const p = (!quiet && !asJson) ? await import('@clack/prompts') : null;
        const spinner = p?.spinner() ?? null;
        if (p) {
            p.intro(color.bgBlue(color.black(' 0ctx enable ')));
            spinner?.start('Preparing local runtime');
        }

        const steps: Array<{ id: string; status: CheckStatus; message: string; details?: Record<string, unknown> }> = [];
        const installCode = await commandInstall({ ...flags, quiet: true, json: false, 'skip-bootstrap': true });
        steps.push({
            id: 'runtime',
            status: installCode === 0 ? 'pass' : 'fail',
            message: installCode === 0 ? 'Local runtime is ready.' : 'Failed to start or verify the local runtime.'
        });
        if (installCode !== 0) {
            if (spinner) spinner.stop(color.red('Runtime preparation failed'));
            if (asJson) console.log(JSON.stringify({ ok: false, repoRoot, steps }, null, 2));
            else {
                console.error('enable_runtime_failed: unable to prepare the local runtime');
                p?.outro(color.red('Enable failed'));
            }
            return 1;
        }

        if (spinner) spinner.message('Resolving workspace');
        const contexts = await deps.sendToDaemon('listContexts', {}) as Array<{ id?: string; name?: string; paths?: string[] }>;
        let contextId = deps.selectHookContextId(contexts, repoRoot, null);
        let created = false;
        if (!contextId) {
            const createdContext = await deps.sendToDaemon('createContext', { name: workspaceName, paths: [repoRoot] }) as { id?: string; contextId?: string };
            contextId = createdContext?.id ?? createdContext?.contextId ?? null;
            created = Boolean(contextId);
        }
        if (!contextId) {
            steps.push({ id: 'workspace', status: 'fail', message: 'Failed to resolve or create a workspace for the repository.' });
            if (spinner) spinner.stop(color.red('Workspace resolution failed'));
            if (asJson) console.log(JSON.stringify({ ok: false, repoRoot, steps }, null, 2));
            else {
                console.error('enable_workspace_failed: unable to resolve or create a workspace');
                p?.outro(color.red('Enable failed'));
            }
            return 1;
        }

        await deps.sendToDaemon('switchContext', { contextId });
        steps.push({ id: 'workspace', status: 'pass', message: created ? `Created and selected workspace '${workspaceName}'.` : 'Selected the workspace bound to this repository.', details: { contextId, repoRoot, created } });

        let bootstrapResults: BootstrapResult[] = [];
        if (!skipBootstrap && mcpClients.length > 0) {
            if (spinner) spinner.message('Registering MCP clients');
            bootstrapResults = deps.runBootstrap(mcpClients, false, undefined, mcpProfile);
            const failedBootstrap = bootstrapResults.some(result => result.status === 'failed');
            steps.push({ id: 'mcp', status: failedBootstrap ? 'fail' : 'pass', message: failedBootstrap ? 'One or more MCP registrations failed.' : 'MCP registration completed.', details: { clients: mcpClients, profile: mcpProfile, results: bootstrapResults } });
            if (failedBootstrap) {
                if (spinner) spinner.stop(color.red('MCP registration failed'));
                if (asJson) console.log(JSON.stringify({ ok: false, repoRoot, contextId, steps }, null, 2));
                else {
                    await deps.printBootstrapResults(bootstrapResults, false);
                    p?.outro(color.red('Enable failed'));
                }
                return 1;
            }
        } else {
            steps.push({ id: 'mcp', status: 'warn', message: skipBootstrap ? 'Skipped MCP registration.' : 'No MCP clients selected for registration.', details: { clients: mcpClients, profile: mcpProfile } });
        }

        let hookSummary: ReturnType<typeof deps.installHooks> | null = null;
        let hookHealthDetails: Awaited<ReturnType<typeof deps.collectHookHealth>>['details'] | null = null;
        if (!skipHooks && hookClients.length > 0) {
            if (spinner) spinner.message('Installing capture integrations');
            hookSummary = deps.installHooks({ projectRoot: repoRoot, contextId, clients: hookClients, installClaudeGlobal: Boolean(flags.global) });
            steps.push({ id: 'capture', status: 'pass', message: 'Capture integrations installed.', details: { clients: hookClients, changed: hookSummary.changed, statePath: hookSummary.statePath, projectConfigPath: hookSummary.projectConfigPath } });
            hookHealthDetails = (await deps.collectHookHealth()).details;
        } else {
            steps.push({ id: 'capture', status: 'warn', message: skipHooks ? 'Skipped capture integration installation.' : 'No capture integrations selected for installation.', details: { clients: hookClients } });
        }

        if (spinner) spinner.stop(color.green('0ctx is enabled for this repository'));
        const repoReadiness = await deps.collectRepoReadiness({ repoRoot, contextId, hookDetails: hookHealthDetails });

        if (asJson) {
            console.log(JSON.stringify({
                ok: true, repoRoot, contextId, workspaceName, created, hookClients, mcpClients, mcpProfile, steps, bootstrapResults, hooks: hookSummary, repoReadiness,
                dataPolicy: repoReadiness ? {
                    syncPolicy: deps.formatSyncPolicyLabel(repoReadiness.syncPolicy),
                    captureRetentionDays: repoReadiness.captureRetentionDays,
                    debugRetentionDays: repoReadiness.debugRetentionDays,
                    debugArtifactsEnabled: repoReadiness.debugArtifactsEnabled
                } : null
            }, null, 2));
            return 0;
        }

        const info = repoReadiness ? [
            deps.formatLabelValue('Repo', repoReadiness.repoRoot),
            deps.formatLabelValue('Workspace', repoReadiness.workspaceName ?? workspaceName),
            deps.formatLabelValue('Workstream', repoReadiness.workstream ?? '-'),
            deps.formatLabelValue('Capture', repoReadiness.captureMissingAgents.length === 0 ? `${deps.formatAgentList(repoReadiness.captureReadyAgents)} ready` : `${deps.formatAgentList(repoReadiness.captureReadyAgents)} ready${repoReadiness.captureReadyAgents.length > 0 ? '; ' : ''}${deps.formatAgentList(repoReadiness.captureMissingAgents)} not installed`),
            deps.formatLabelValue('Context', repoReadiness.autoContextAgents.length > 0 ? `${deps.formatAgentList(repoReadiness.autoContextAgents)} inject current workstream context automatically` : 'No supported context injection integrations installed yet'),
            deps.formatLabelValue('History', repoReadiness.sessionCount === null ? 'No captured workstream history yet' : `${repoReadiness.sessionCount} sessions, ${repoReadiness.checkpointCount ?? 0} checkpoints`),
            deps.formatLabelValue('Data policy', deps.formatDataPolicyNarrative({ syncPolicy: repoReadiness.syncPolicy, captureRetentionDays: repoReadiness.captureRetentionDays, debugRetentionDays: repoReadiness.debugRetentionDays, debugArtifactsEnabled: repoReadiness.debugArtifactsEnabled }))
        ] : [deps.formatLabelValue('Repo', repoRoot), deps.formatLabelValue('Workspace', workspaceName)];

        p?.note(info.join('\n'), 'Repo Readiness');
        p?.outro(color.green('Use a supported agent normally in this repo. 0ctx will inject current context and route capture automatically.'));
        return 0;
    }

    return { commandInstall, commandEnable };
}
