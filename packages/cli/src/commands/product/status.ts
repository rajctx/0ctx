import fs from 'fs';
import color from 'picocolors';
import type { ProductCommandDeps, FlagMap } from './types';
import { buildRepoReadinessLines } from './repo-readiness-display';

export function createStatusCommands(deps: ProductCommandDeps) {
    async function commandStatus(flags: FlagMap = {}): Promise<number> {
        const asJson = Boolean(flags.json);
        const compact = Boolean(flags.compact);
        const p = (asJson || compact) ? null : await import('@clack/prompts');
        const spinner = p ? p.spinner() : null;

        if (p && spinner) {
            p.intro(color.bgCyan(color.black(' 0ctx status ')));
            spinner.start('Checking daemon health');
        }

        let daemon = await deps.isDaemonReachable();
        if (!daemon.ok) {
            if (spinner) spinner.message('Daemon not running — starting...');
            try {
                deps.startDaemonDetached();
                if (await deps.waitForDaemon(8000)) {
                    daemon = await deps.isDaemonReachable();
                }
            } catch {
                // Best-effort only.
            }
        }

        if (spinner) {
            spinner.stop(`Daemon is ${daemon.ok ? color.green('running') : color.red('not running')}`);
        }

        let capabilities: any = null;
        const missingFeatures: string[] = [];
        const recoverySteps = daemon.ok ? [] : deps.inferDaemonRecoverySteps(daemon.error);
        let apiError: string | null = null;

        if (daemon.ok) {
            try {
                capabilities = await deps.sendToDaemon('getCapabilities', {});
                const methodNames = Array.isArray(capabilities?.methods) ? capabilities.methods : [];
                if (!methodNames.includes('recall')) missingFeatures.push('recall');
            } catch (error) {
                apiError = error instanceof Error ? error.message : String(error);
            }
        }

        const methodNames = Array.isArray(capabilities?.methods) ? capabilities.methods : [];
        const repoRootHint = deps.findGitRepoRoot(null);
        const repoReadiness = daemon.ok && repoRootHint
            ? await deps.collectRepoReadiness({ repoRoot: repoRootHint }).catch(() => null)
            : null;

        const payload = {
            ok: daemon.ok && missingFeatures.length === 0,
            daemon: {
                running: daemon.ok,
                error: daemon.ok ? null : (daemon.error ?? 'unknown'),
                recoverySteps,
                health: daemon.ok ? (daemon.health ?? null) : null
            },
            paths: {
                socket: deps.SOCKET_PATH,
                database: deps.DB_PATH,
                masterKeyPath: deps.KEY_PATH,
                masterKeyPresent: fs.existsSync(deps.KEY_PATH) || Boolean(process.env.CTX_MASTER_KEY)
            },
            capabilities: daemon.ok ? {
                apiVersion: capabilities?.apiVersion ?? 'unknown',
                methodCount: methodNames.length,
                methods: methodNames,
                missingFeatures
            } : null,
            apiError,
            repo: {
                insideRepo: Boolean(repoRootHint),
                repoRoot: repoRootHint,
                readiness: repoReadiness
            }
        };

        if (asJson) {
            console.log(JSON.stringify(payload, null, 2));
            return payload.ok ? 0 : 1;
        }
        if (compact) {
            const methodCount = payload.capabilities?.methodCount ?? 0;
            const missing = payload.capabilities?.missingFeatures ?? [];
            const sync = payload.daemon.health?.sync as { enabled?: boolean; running?: boolean } | null | undefined;
            const syncState = sync ? `enabled=${Boolean(sync.enabled)} running=${Boolean(sync.running)}` : 'enabled=false running=false';
            const reason = payload.daemon.running ? (missing.length > 0 ? `missing=${missing.join(',')}` : 'healthy') : `error=${payload.daemon.error ?? 'unknown'}`;
            const repoState = repoReadiness
                ? ` repo="${repoReadiness.repoRoot}" workspace="${repoReadiness.workspaceName ?? '-'}" zero_touch=${repoReadiness.zeroTouchReady} policy="${deps.formatSyncPolicyLabel(repoReadiness.syncPolicy)}" capture="${repoReadiness.captureRetentionDays}d" debug="${repoReadiness.debugArtifactsEnabled ? 'on' : 'off'}:${repoReadiness.debugRetentionDays}d"`
                : '';
            console.log(`status=${payload.ok ? 'ok' : 'degraded'} daemon=${payload.daemon.running ? 'running' : 'offline'} methods=${methodCount} sync="${syncState}" reason=${reason}${repoState}`);
            return payload.ok ? 0 : 1;
        }
        if (!p) return payload.ok ? 0 : 1;

        if (!payload.daemon.running) {
            const info: string[] = [];
            if (payload.daemon.error) info.push(deps.formatLabelValue('Runtime', color.red(payload.daemon.error)));
            for (const [idx, step] of payload.daemon.recoverySteps.entries()) {
                info.push(deps.formatLabelValue(`Recover ${idx + 1}`, color.yellow(step)));
            }
            p.note(info.join('\n'), 'Runtime Unavailable');
            p.outro(color.yellow('0ctx runtime is unavailable on this machine.'));
            return 1;
        }

        if (payload.capabilities && payload.capabilities.missingFeatures.length > 0) {
            const info = [
                deps.formatLabelValue('Runtime', color.yellow('needs upgrade')),
                deps.formatLabelValue('Missing', payload.capabilities.missingFeatures.join(', ')),
                deps.formatLabelValue('Next step', '0ctx enable')
            ];
            p.note(info.join('\n'), 'Runtime Readiness');
            p.outro(color.yellow('0ctx runtime is reachable, but this CLI expects newer capabilities.'));
            return 1;
        }

        if (!repoRootHint) {
            p.note([
                deps.formatLabelValue('Runtime', color.green('ready')),
                deps.formatLabelValue('Directory', 'Not inside a git repo'),
                deps.formatLabelValue('Next step', 'cd <repo> && 0ctx enable')
            ].join('\n'), 'Local Product Path');
            p.outro(color.green('0ctx runtime is ready.'));
            return 0;
        }

        if (!repoReadiness) {
            p.note([
                deps.formatLabelValue('Runtime', color.green('ready')),
                deps.formatLabelValue('Repo', repoRootHint),
                deps.formatLabelValue('Next step', '0ctx enable')
            ].join('\n'), 'Repo Readiness');
            p.outro(color.green('0ctx runtime is ready.'));
            return 0;
        }

        if (!repoReadiness.contextId || !repoReadiness.workspaceName) {
            p.note([
                deps.formatLabelValue('Repo', repoReadiness.repoRoot),
                deps.formatLabelValue('Workspace', color.yellow('not enabled')),
                deps.formatLabelValue('Workstream', repoReadiness.workstream ?? '-'),
                deps.formatLabelValue('Next step', '0ctx enable')
            ].join('\n'), 'Repo Readiness');
            p.outro(color.yellow('This repo is not enabled for 0ctx yet.'));
            return 1;
        }

        p.note(buildRepoReadinessLines({
            mode: 'status',
            repoReadiness,
            formatAgentList: deps.formatAgentList,
            formatLabelValue: deps.formatLabelValue,
            formatRetentionLabel: deps.formatRetentionLabel,
            formatSyncPolicyLabel: deps.formatSyncPolicyLabel
        }).join('\n'), 'Repo Readiness');
        p.outro(color.green('Use a supported agent normally in this repo. 0ctx will inject context and route capture automatically.'));
        return payload.ok ? 0 : 1;
    }

    return { commandStatus };
}
