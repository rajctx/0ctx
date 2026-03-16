import fs from 'fs';
import path from 'path';
import color from 'picocolors';
import type { BootstrapResult, DoctorCheck, FlagMap, HealthCommandDeps, RepairStep } from './types';

export function createHealthCommands(deps: HealthCommandDeps) {
    async function collectRepoZeroTouchCheck(): Promise<DoctorCheck | null> {
        const repoRoot = deps.findGitRepoRoot(null);
        if (!repoRoot) return null;

        const repoReadiness = await deps.collectRepoReadiness({ repoRoot }).catch(() => null);
        if (!repoReadiness) {
            return {
                id: 'repo_zero_touch',
                status: 'warn',
                message: 'Current repo readiness could not be resolved.',
                details: { repoRoot }
            };
        }

        if (!repoReadiness.contextId || !repoReadiness.workspaceName) {
            return {
                id: 'repo_zero_touch',
                status: 'warn',
                message: 'Current repo is not enabled for automatic context yet.',
                details: {
                    repoRoot,
                    nextActionHint: repoReadiness.nextActionHint ?? 'Run 0ctx enable in this repo.'
                }
            };
        }

        return {
            id: 'repo_zero_touch',
            status: repoReadiness.zeroTouchReady ? 'pass' : 'warn',
            message: repoReadiness.zeroTouchReady
                ? 'Current repo is zero-touch ready for supported agents.'
                : 'Current repo still needs one-time automatic-context setup.',
            details: {
                repoRoot,
                workspaceName: repoReadiness.workspaceName,
                captureReadyAgents: repoReadiness.captureReadyAgents,
                autoContextAgents: repoReadiness.autoContextAgents,
                autoContextMissingAgents: repoReadiness.autoContextMissingAgents,
                sessionStartMissingAgents: repoReadiness.sessionStartMissingAgents,
                mcpRegistrationMissingAgents: repoReadiness.mcpRegistrationMissingAgents,
                nextActionHint: repoReadiness.nextActionHint
            }
        };
    }

    async function collectDoctorChecks(flags: FlagMap): Promise<{ checks: DoctorCheck[]; daemon: { ok: boolean; error?: string; health?: any } }> {
        const checks: DoctorCheck[] = [];
        const daemon = await deps.isDaemonReachable();

        checks.push({
            id: 'daemon_reachable',
            status: daemon.ok ? 'pass' : 'fail',
            message: daemon.ok ? 'Daemon health check succeeded.' : 'Daemon is not reachable.',
            details: daemon.ok ? daemon.health : {
                error: daemon.error,
                recoverySteps: deps.inferDaemonRecoverySteps(daemon.error)
            }
        });

        checks.push({
            id: 'db_path',
            status: fs.existsSync(deps.DB_PATH) ? 'pass' : 'warn',
            message: fs.existsSync(deps.DB_PATH) ? 'Database file exists.' : 'Database file not found yet (may be created on first run).',
            details: { path: deps.DB_PATH }
        });

        const hasKey = Boolean(process.env.CTX_MASTER_KEY) || fs.existsSync(deps.KEY_PATH);
        checks.push({
            id: 'encryption_key',
            status: hasKey ? 'pass' : 'warn',
            message: hasKey ? 'Encryption key available.' : 'Encryption key file/env not found yet.',
            details: { env: Boolean(process.env.CTX_MASTER_KEY), file: deps.KEY_PATH }
        });

        const opsLogPath = deps.getCliOpsLogPath();
        let opsLogWritable = true;
        let opsLogError: string | null = null;
        try {
            const dir = path.dirname(opsLogPath);
            fs.mkdirSync(dir, { recursive: true });
            fs.accessSync(dir, fs.constants.W_OK);
            if (fs.existsSync(opsLogPath)) {
                fs.accessSync(opsLogPath, fs.constants.W_OK);
            }
        } catch (error) {
            opsLogWritable = false;
            opsLogError = error instanceof Error ? error.message : String(error);
        }
        checks.push({
            id: 'ops_log_writable',
            status: opsLogWritable ? 'pass' : 'warn',
            message: opsLogWritable ? 'CLI operations log path is writable.' : 'CLI operations log path is not writable.',
            details: { path: opsLogPath, error: opsLogError }
        });

        const dryRunResults = deps.runBootstrap(deps.parseClients(flags.clients), true);
        const failedBootstrap = dryRunResults.some((result: BootstrapResult) => result.status === 'failed');
        checks.push({
            id: 'bootstrap_dry_run',
            status: failedBootstrap ? 'fail' : 'pass',
            message: failedBootstrap ? 'Bootstrap dry run found failures.' : 'Bootstrap dry run succeeded (or skipped unsupported clients).',
            details: { results: dryRunResults }
        });

        const hookHealth = await deps.collectHookHealth();
        checks.push(hookHealth.check);
        checks.push(hookHealth.dumpCheck);

        if (daemon.ok) {
            const repoZeroTouchCheck = await collectRepoZeroTouchCheck();
            if (repoZeroTouchCheck) checks.push(repoZeroTouchCheck);
        }

        return { checks, daemon };
    }

    async function repairRepoZeroTouch(flags: FlagMap): Promise<RepairStep | null> {
        const repoRoot = deps.findGitRepoRoot(null);
        if (!repoRoot) return null;

        const initialReadiness = await deps.collectRepoReadiness({ repoRoot }).catch(() => null);
        if (!initialReadiness || !initialReadiness.contextId || !initialReadiness.workspaceName) {
            return {
                id: 'repo_zero_touch',
                status: 'warn',
                code: 0,
                message: 'Current repo is not enabled yet.',
                details: {
                    repoRoot,
                    nextActionHint: initialReadiness?.nextActionHint ?? 'Run 0ctx enable in this repo.'
                }
            };
        }

        if (initialReadiness.zeroTouchReady) {
            return {
                id: 'repo_zero_touch',
                status: 'pass',
                code: 0,
                message: 'Current repo is already zero-touch ready for supported agents.',
                details: { repoRoot, workspaceName: initialReadiness.workspaceName }
            };
        }

        const repaired: string[] = [];

        if (initialReadiness.captureManagedForRepo && initialReadiness.sessionStartMissingAgents.length > 0) {
            deps.installHooks({
                projectRoot: repoRoot,
                contextId: initialReadiness.contextId,
                clients: initialReadiness.captureReadyAgents,
                dryRun: false,
                cliCommand: '0ctx'
            });
            repaired.push(`capture hooks (${initialReadiness.sessionStartMissingAgents.join(', ')})`);
        }

        if (initialReadiness.mcpRegistrationMissingAgents.length > 0) {
            const bootstrapCode = await deps.commandBootstrap({
                ...flags,
                quiet: true,
                json: false,
                clients: initialReadiness.mcpRegistrationMissingAgents.join(','),
                'mcp-profile': 'core'
            });
            if (bootstrapCode !== 0) {
                return {
                    id: 'repo_zero_touch',
                    status: 'fail',
                    code: bootstrapCode,
                    message: 'Failed to repair automatic retrieval for the current repo.',
                    details: {
                        repoRoot,
                        workspaceName: initialReadiness.workspaceName,
                        attemptedMcpClients: initialReadiness.mcpRegistrationMissingAgents
                    }
                };
            }
            repaired.push(`automatic retrieval (${initialReadiness.mcpRegistrationMissingAgents.join(', ')})`);
        }

        const finalReadiness = await deps.collectRepoReadiness({ repoRoot, contextId: initialReadiness.contextId }).catch(() => null);
        if (finalReadiness?.zeroTouchReady) {
            return {
                id: 'repo_zero_touch',
                status: 'pass',
                code: 0,
                message: 'Current repo is now zero-touch ready for supported agents.',
                details: {
                    repoRoot,
                    workspaceName: finalReadiness.workspaceName,
                    repaired
                }
            };
        }

        return {
            id: 'repo_zero_touch',
            status: 'warn',
            code: 0,
            message: 'Current repo still needs one-time automatic-context setup.',
            details: {
                repoRoot,
                workspaceName: finalReadiness?.workspaceName ?? initialReadiness.workspaceName,
                repaired,
                nextActionHint: finalReadiness?.nextActionHint ?? initialReadiness.nextActionHint
            }
        };
    }

    async function commandDoctor(flags: FlagMap): Promise<number> {
        const { checks, daemon } = await collectDoctorChecks(flags);
        const hasFailures = checks.some(check => check.status === 'fail');
        const asJson = Boolean(flags.json);
        if (asJson) {
            console.log(JSON.stringify({ checks }, null, 2));
            return hasFailures ? 1 : 0;
        }

        const p = await import('@clack/prompts');
        p.intro(color.bgCyan(color.black(' 0ctx doctor ')));

        for (const check of checks) {
            if (check.status === 'pass') {
                p.log.success(`${color.bold(check.id)}: ${color.dim(check.message)}`);
            } else if (check.status === 'warn') {
                p.log.warn(`${color.bold(check.id)}: ${color.yellow(check.message)}`);
            } else {
                p.log.error(`${color.bold(check.id)}: ${color.red(check.message)}`);
            }
        }

        if (!daemon.ok) {
            const recovery = deps.inferDaemonRecoverySteps(daemon.error);
            console.log('\nDaemon recovery steps:');
            for (const [idx, step] of recovery.entries()) {
                console.log(`  ${idx + 1}. ${step}`);
            }
            console.log('');
        }

        p.outro(hasFailures ? color.red('Doctor found issues requiring attention.') : color.green('All systems go!'));
        return hasFailures ? 1 : 0;
    }

    async function repairManagedHooks(flags: FlagMap): Promise<RepairStep> {
        const hookState = deps.readHookInstallState();
        const projectRoot = hookState.projectRoot ? path.resolve(hookState.projectRoot) : null;
        const installedAgents = hookState.agents.filter(agent => agent.installed).map(agent => agent.agent);

        if (!projectRoot || installedAgents.length === 0) {
            return {
                id: 'hooks_reinstall',
                status: 'warn',
                code: 0,
                message: 'No managed capture integration installation is recorded yet.',
                details: { statePath: deps.getHookStatePath(), projectRoot: projectRoot ?? null }
            };
        }

        if (!fs.existsSync(projectRoot)) {
            return {
                id: 'hooks_reinstall',
                status: 'fail',
                code: 1,
                message: 'Managed capture integration project root is missing.',
                details: { projectRoot }
            };
        }

        const refreshedContextId = await deps.resolveContextIdForHookIngest(projectRoot, hookState.contextId ?? null);
        const result = deps.installHooks({
            projectRoot,
            contextId: refreshedContextId,
            clients: installedAgents,
            dryRun: false,
            cliCommand: '0ctx'
        });
        const failedAgents = result.state.agents.filter(agent => installedAgents.includes(agent.agent) && !agent.installed).map(agent => agent.agent);

        return {
            id: 'hooks_reinstall',
            status: failedAgents.length === 0 ? 'pass' : 'fail',
            code: failedAgents.length === 0 ? 0 : 1,
            message: failedAgents.length === 0
                ? 'Managed capture integrations were refreshed from the recorded project state.'
                : `Managed capture integrations failed for: ${failedAgents.join(', ')}`,
            details: { projectRoot, refreshedContextId, warnings: result.warnings, agents: result.state.agents }
        };
    }

    async function commandRepair(flags: FlagMap): Promise<number> {
        const deep = Boolean(flags.deep);
        const asJson = Boolean(flags.json);

        if (asJson) {
            const steps: RepairStep[] = [];
            const daemon = await deps.isDaemonReachable();

            if (!daemon.ok) {
                try {
                    deps.startDaemonDetached();
                } catch (error) {
                    steps.push({ id: 'daemon_start', status: 'fail', code: 1, message: 'Failed to start daemon.', details: { error: error instanceof Error ? error.message : String(error) } });
                    console.log(JSON.stringify({ ok: false, steps }, null, 2));
                    return 1;
                }

                const ready = await deps.waitForDaemon();
                steps.push({ id: 'daemon_start', status: ready ? 'pass' : 'fail', code: ready ? 0 : 1, message: ready ? 'Daemon started successfully.' : 'Daemon start timeout.', details: { priorError: daemon.error ?? null } });
                if (!ready) {
                    console.log(JSON.stringify({ ok: false, steps }, null, 2));
                    return 1;
                }
            } else {
                steps.push({ id: 'daemon_start', status: 'pass', code: 0, message: 'Daemon already running.' });
            }

            const bootstrapCode = await deps.commandBootstrap({ ...flags, quiet: true, json: false });
            steps.push({ id: 'bootstrap', status: bootstrapCode === 0 ? 'pass' : 'fail', code: bootstrapCode, message: bootstrapCode === 0 ? 'Bootstrap completed.' : 'Bootstrap failed.' });
            if (bootstrapCode !== 0) {
                console.log(JSON.stringify({ ok: false, steps }, null, 2));
                return bootstrapCode;
            }

            const hookRepairStep = await repairManagedHooks(flags);
            steps.push(hookRepairStep);
            if (hookRepairStep.status === 'fail') {
                console.log(JSON.stringify({ ok: false, steps }, null, 2));
                return hookRepairStep.code || 1;
            }

            const repoZeroTouchStep = await repairRepoZeroTouch(flags);
            if (repoZeroTouchStep) {
                steps.push(repoZeroTouchStep);
                if (repoZeroTouchStep.status === 'fail') {
                    console.log(JSON.stringify({ ok: false, steps }, null, 2));
                    return repoZeroTouchStep.code || 1;
                }
            }

            if (deep) {
                const check = await deps.ensureDaemonCapabilities(['recall']);
                const recallReady = check.ok;
                steps.push({
                    id: 'deep_capabilities',
                    status: recallReady ? 'pass' : 'fail',
                    code: recallReady ? 0 : 1,
                    message: recallReady ? 'Daemon capability check passed.' : 'Daemon capabilities are stale (recall missing).',
                    details: { capabilityError: check.error, methodCount: check.methods.length, recoverySteps: check.recoverySteps }
                });
                if (!recallReady) {
                    console.log(JSON.stringify({ ok: false, steps }, null, 2));
                    return 1;
                }
            }

            const { checks } = await collectDoctorChecks({ ...flags, json: false });
            const doctorFail = checks.some(check => check.status === 'fail');
            steps.push({ id: 'doctor', status: doctorFail ? 'fail' : 'pass', code: doctorFail ? 1 : 0, message: doctorFail ? 'Doctor checks found failures.' : 'Doctor checks passed.', details: { checks } });

            const ok = steps.every(step => step.status !== 'fail');
            console.log(JSON.stringify({ ok, steps }, null, 2));
            return ok ? 0 : 1;
        }

        const p = await import('@clack/prompts');
        p.intro(color.bgCyan(color.black(' 0ctx repair ')));

        const s = p.spinner();
        s.start('Checking daemon status');

        const daemon = await deps.isDaemonReachable();
        if (!daemon.ok) {
            s.message('Starting daemon for repair...');
            try {
                deps.startDaemonDetached();
            } catch (error) {
                s.stop(color.red('Failed to start daemon'));
                p.log.error(error instanceof Error ? error.message : String(error));
                p.outro(color.red('Repair failed'));
                return 1;
            }
        }

        const ready = await deps.waitForDaemon();
        if (!ready) {
            s.stop(color.red('Daemon start timeout'));
            p.outro(color.red('Repair failed'));
            return 1;
        }

        s.stop(color.green('Daemon is running'));
        p.log.step('Running bootstrap to fix MCP configs');
        const bootstrapCode = await deps.commandBootstrap({ ...flags, quiet: true, json: false });
        if (bootstrapCode !== 0) {
            p.outro(color.yellow('Repair partial (bootstrap failed)'));
            return bootstrapCode;
        }

        p.log.step('Refreshing managed capture integrations');
        const hookRepairStep = await repairManagedHooks(flags);
        if (hookRepairStep.status === 'fail') {
            p.log.error(hookRepairStep.message);
            p.outro(color.yellow('Repair partial (hook refresh failed)'));
            return hookRepairStep.code || 1;
        }
        if (hookRepairStep.status === 'warn') p.log.warn(hookRepairStep.message);
        else p.log.success(hookRepairStep.message);

        const repoZeroTouchStep = await repairRepoZeroTouch(flags);
        if (repoZeroTouchStep) {
            if (repoZeroTouchStep.status === 'fail') {
                p.log.error(repoZeroTouchStep.message);
                p.outro(color.yellow('Repair partial (repo automatic context failed)'));
                return repoZeroTouchStep.code || 1;
            }
            if (repoZeroTouchStep.status === 'warn') p.log.warn(repoZeroTouchStep.message);
            else p.log.success(repoZeroTouchStep.message);
        }

        if (deep) {
            p.log.step('Running deep daemon capability checks');
            const check = await deps.ensureDaemonCapabilities(['recall']);
            if (!check.ok) {
                p.log.warn('Daemon is running but recall APIs are missing.');
                console.log('\nDeep repair steps:\n');
                console.log('  1. Restart daemon/service so latest daemon binary is active');
                for (const step of check.recoverySteps) console.log(`     - ${step}`);
                console.log('  2. Re-run: 0ctx status');
                console.log('  3. Verify: 0ctx recall --start\n');
                p.outro(color.yellow('Repair partial (daemon capabilities stale)'));
                return 1;
            }
            p.log.success('Deep capability check passed');
        }

        p.log.step('Running doctor checks');
        return commandDoctor({ ...flags, json: false });
    }

    return {
        collectDoctorChecks,
        commandDoctor,
        commandRepair
    };
}
