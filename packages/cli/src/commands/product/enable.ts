import path from 'path';
import color from 'picocolors';
import type { ProductCommandDeps, FlagMap, CheckStatus, BootstrapResult } from './types';
import { createInstallCommand } from './install';
import { buildRepoReadinessLines } from './repo-readiness-display';

type DataPolicyPreset = 'lean' | 'review' | 'debug' | 'shared';

function parseDataPolicyPreset(value: string | null): DataPolicyPreset | null {
    if (value === 'lean' || value === 'review' || value === 'debug' || value === 'shared') {
        return value;
    }
    return null;
}

export function createEnableCommands(deps: ProductCommandDeps & { commandBootstrap: (flags: FlagMap) => Promise<number> }) {
    const commandInstall = createInstallCommand(deps);

    async function commandEnable(flags: FlagMap): Promise<number> {
        const quiet = Boolean(flags.quiet);
        const asJson = Boolean(flags.json);
        const skipBootstrap = Boolean(flags['skip-bootstrap']);
        const skipHooks = Boolean(flags['skip-hooks']);
        const repoRoot = deps.resolveRepoRoot(deps.parseOptionalStringFlag(flags['repo-root'] ?? flags.repoRoot));
        const requestedName = deps.parseOptionalStringFlag(flags.name ?? flags['workspace-name'] ?? flags.workspaceName);
        const requestedDataPolicy = deps.parseOptionalStringFlag(flags['data-policy'] ?? flags.dataPolicy);
        const dataPolicyPreset = parseDataPolicyPreset(requestedDataPolicy);
        const workspaceName = requestedName ?? (path.basename(repoRoot) || 'Workspace');
        const selectedPreviewHooks = deps.detectPreviewSelections(flags.clients, 'codex,cursor,windsurf');
        if (selectedPreviewHooks.length > 0) {
            console.error(`0ctx enable supports only GA capture integrations. Use --clients=ga for the normal path, or use advanced commands like \`0ctx setup --allow-preview\` or \`0ctx connector hook install --allow-preview\` if you intentionally need preview integrations (${selectedPreviewHooks.join(', ')}).`);
            return 1;
        }
        if (requestedDataPolicy && !dataPolicyPreset) {
            console.error('Invalid data policy. Use lean, review, debug, or shared.');
            return 1;
        }
        const selectedPreviewMcp = deps.detectPreviewSelections(flags['mcp-clients'] ?? flags.mcpClients, 'codex');
        if (selectedPreviewMcp.length > 0) {
            console.error(`MCP clients: 0ctx enable supports only GA automatic retrieval targets. Use --mcp-clients=ga for the normal path, or use \`0ctx bootstrap --allow-preview\` only when you intentionally need preview retrieval (${selectedPreviewMcp.join(', ')}).`);
            return 1;
        }

        const detectedHookClients = deps.detectInstalledGaHookClients();
        const detectedMcpClients = deps.detectInstalledGaMcpClients();
        const hookClients = flags.clients
            ? deps.parseHookClients(flags.clients)
            : detectedHookClients.length > 0
                ? detectedHookClients
                : deps.parseHookClients(undefined);
        const mcpClients = (flags['mcp-clients'] ?? flags.mcpClients)
            ? deps.parseEnableMcpClients(flags['mcp-clients'] ?? flags.mcpClients)
            : detectedMcpClients.length > 0
                ? detectedMcpClients
                : deps.parseEnableMcpClients(undefined);
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
        steps.push({
            id: 'workspace',
            status: 'pass',
            message: created ? `Created and selected workspace '${workspaceName}'.` : 'Selected the workspace bound to this repository.',
            details: { contextId, repoRoot, created, detectedHookClients, detectedMcpClients }
        });

        if (dataPolicyPreset) {
            if (spinner) spinner.message('Applying data policy');
            const dataPolicy = await deps.sendToDaemon('setDataPolicy', {
                contextId,
                preset: dataPolicyPreset
            }) as {
                preset?: string;
                syncScope?: 'workspace';
                captureScope?: 'machine';
                debugScope?: 'machine';
                syncPolicy?: string | null;
                captureRetentionDays?: number;
                debugRetentionDays?: number;
                debugArtifactsEnabled?: boolean;
            };
            steps.push({
                id: 'data_policy',
                status: 'pass',
                message: `Applied the ${dataPolicyPreset} data policy preset.`,
                details: {
                    preset: dataPolicy.preset ?? dataPolicyPreset,
                    syncScope: dataPolicy.syncScope ?? 'workspace',
                    captureScope: dataPolicy.captureScope ?? 'machine',
                    debugScope: dataPolicy.debugScope ?? 'machine',
                    syncPolicy: dataPolicy.syncPolicy ?? null,
                    captureRetentionDays: dataPolicy.captureRetentionDays ?? null,
                    debugRetentionDays: dataPolicy.debugRetentionDays ?? null,
                    debugArtifactsEnabled: dataPolicy.debugArtifactsEnabled ?? null
                }
            });
        } else {
            const currentDataPolicy = await deps.sendToDaemon('getDataPolicy', { contextId }) as {
                preset?: string | null;
                syncScope?: 'workspace';
                captureScope?: 'machine';
                debugScope?: 'machine';
                syncPolicy?: string | null;
                captureRetentionDays?: number;
                debugRetentionDays?: number;
                debugArtifactsEnabled?: boolean;
            };
            const currentPreset = typeof currentDataPolicy?.preset === 'string' ? currentDataPolicy.preset : 'custom';
            if (created || currentPreset === 'custom') {
                if (spinner) spinner.message('Applying default lean data policy');
                const normalizedDataPolicy = await deps.sendToDaemon('setDataPolicy', {
                    contextId,
                    preset: 'lean'
                }) as {
                    preset?: string;
                    syncScope?: 'workspace';
                    captureScope?: 'machine';
                    debugScope?: 'machine';
                    syncPolicy?: string | null;
                    captureRetentionDays?: number;
                    debugRetentionDays?: number;
                    debugArtifactsEnabled?: boolean;
                };
                steps.push({
                    id: 'data_policy',
                    status: 'pass',
                    message: created
                        ? 'Applied the default lean data policy for this new workspace.'
                        : 'Normalized the current custom data policy to the lean default.',
                    details: {
                        preset: normalizedDataPolicy.preset ?? 'lean',
                        syncScope: normalizedDataPolicy.syncScope ?? 'workspace',
                        captureScope: normalizedDataPolicy.captureScope ?? 'machine',
                        debugScope: normalizedDataPolicy.debugScope ?? 'machine',
                        syncPolicy: normalizedDataPolicy.syncPolicy ?? null,
                        captureRetentionDays: normalizedDataPolicy.captureRetentionDays ?? null,
                        debugRetentionDays: normalizedDataPolicy.debugRetentionDays ?? null,
                        debugArtifactsEnabled: normalizedDataPolicy.debugArtifactsEnabled ?? null,
                        normalizedFrom: currentPreset
                    }
                });
            } else {
                steps.push({
                    id: 'data_policy',
                    status: 'pass',
                    message: `Using the current ${currentPreset} data policy.`,
                    details: {
                        preset: currentPreset,
                        syncScope: currentDataPolicy?.syncScope ?? 'workspace',
                        captureScope: currentDataPolicy?.captureScope ?? 'machine',
                        debugScope: currentDataPolicy?.debugScope ?? 'machine',
                        syncPolicy: currentDataPolicy?.syncPolicy ?? null,
                        captureRetentionDays: currentDataPolicy?.captureRetentionDays ?? null,
                        debugRetentionDays: currentDataPolicy?.debugRetentionDays ?? null,
                        debugArtifactsEnabled: currentDataPolicy?.debugArtifactsEnabled ?? null
                    }
                });
            }
        }

        let bootstrapResults: BootstrapResult[] = [];
        if (!skipBootstrap && mcpClients.length > 0) {
            if (spinner) spinner.message('Enabling automatic retrieval');
            bootstrapResults = deps.runBootstrap(mcpClients, false, undefined, mcpProfile);
            const failedBootstrap = bootstrapResults.some(result => result.status === 'failed');
            steps.push({
                id: 'mcp',
                status: failedBootstrap ? 'fail' : 'pass',
                message: failedBootstrap ? 'One or more automatic retrieval setup steps failed.' : 'Automatic retrieval setup completed.',
                details: { clients: mcpClients, profile: mcpProfile, results: bootstrapResults }
            });
            if (failedBootstrap) {
                if (spinner) spinner.stop(color.red('Automatic retrieval setup failed'));
                if (asJson) console.log(JSON.stringify({ ok: false, repoRoot, contextId, steps }, null, 2));
                else {
                    await deps.printBootstrapResults(bootstrapResults, false);
                    p?.outro(color.red('Enable failed'));
                }
                return 1;
            }
        } else {
            steps.push({
                id: 'mcp',
                status: 'warn',
                message: skipBootstrap
                    ? 'Skipped automatic retrieval setup.'
                    : 'No supported automatic retrieval targets were selected.',
                details: { clients: mcpClients, profile: mcpProfile, detectedClients: detectedMcpClients }
            });
        }

        let hookSummary: ReturnType<typeof deps.installHooks> | null = null;
        if (!skipHooks && hookClients.length > 0) {
            if (spinner) spinner.message('Installing capture integrations');
            hookSummary = deps.installHooks({ projectRoot: repoRoot, contextId, clients: hookClients, installClaudeGlobal: Boolean(flags.global) });
            steps.push({ id: 'capture', status: 'pass', message: 'Capture integrations installed.', details: { clients: hookClients, changed: hookSummary.changed, statePath: hookSummary.statePath, projectConfigPath: hookSummary.projectConfigPath } });
        } else {
            steps.push({
                id: 'capture',
                status: 'warn',
                message: skipHooks
                    ? 'Skipped capture integration installation.'
                    : 'No GA capture integrations were selected for installation.',
                details: { clients: hookClients, detectedClients: detectedHookClients }
            });
        }

        if (spinner) spinner.stop(color.green('0ctx is enabled for this repository'));
        const repoReadiness = await deps.collectRepoReadiness({ repoRoot, contextId });

        if (asJson) {
            console.log(JSON.stringify({
                ok: true, repoRoot, contextId, workspaceName, created, hookClients, mcpClients, mcpProfile, dataPolicyPreset, steps, bootstrapResults, hooks: hookSummary, repoReadiness,
                detectedHookClients,
                detectedMcpClients,
                dataPolicy: repoReadiness ? {
                    preset: repoReadiness.dataPolicyPreset ?? dataPolicyPreset ?? null,
                    syncScope: repoReadiness.syncScope,
                    captureScope: repoReadiness.captureScope,
                    debugScope: repoReadiness.debugScope,
                    syncPolicy: deps.formatSyncPolicyLabel(repoReadiness.syncPolicy),
                    captureRetentionDays: repoReadiness.captureRetentionDays,
                    debugRetentionDays: repoReadiness.debugRetentionDays,
                    debugArtifactsEnabled: repoReadiness.debugArtifactsEnabled
                } : null
            }, null, 2));
            return 0;
        }

        const info = repoReadiness
            ? buildRepoReadinessLines({
                mode: 'enable',
                repoReadiness: {
                    ...repoReadiness,
                    workspaceName: repoReadiness.workspaceName ?? workspaceName
                },
                formatAgentList: deps.formatAgentList,
                formatLabelValue: deps.formatLabelValue,
                formatRetentionLabel: deps.formatRetentionLabel,
                formatSyncPolicyLabel: deps.formatSyncPolicyLabel,
                detectedHookClients,
                detectedMcpClients
            })
            : [deps.formatLabelValue('Repo', repoRoot), deps.formatLabelValue('Workspace', workspaceName)];

        p?.note(info.join('\n'), 'Repo Readiness');
        p?.outro(color.green('Use a supported agent normally in this repo. 0ctx will inject current context and route capture automatically.'));
        return 0;
    }

    return { commandInstall, commandEnable };
}
