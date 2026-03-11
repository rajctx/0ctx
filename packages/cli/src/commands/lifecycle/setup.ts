import type { FlagMap, SetupCommandDeps, SetupStep } from './types';
import type { DoctorCheck } from './types';

function statusToCode(status: SetupStep['status']): number {
    return status === 'fail' ? 1 : 0;
}

function printSetupJson(ok: boolean, steps: SetupStep[], dashboardUrl: string): void {
    console.log(JSON.stringify({ ok, steps, dashboardUrl }, null, 2));
}

function connectorVerifyFlags(flags: FlagMap, requireCloud: boolean): FlagMap {
    return {
        ...flags,
        quiet: true,
        json: false,
        'require-cloud': requireCloud,
        cloud: requireCloud
    };
}

async function waitForCloudReady(
    deps: SetupCommandDeps,
    flags: FlagMap,
    cloudWaitTimeoutMs: number,
    cloudWaitIntervalMs: number
): Promise<{ ready: boolean; attempts: number; elapsedMs: number }> {
    const waitStartedAt = Date.now();
    let attempts = 0;
    let ready = false;

    while (Date.now() - waitStartedAt < cloudWaitTimeoutMs) {
        attempts += 1;
        const cloudVerifyCode = await deps.commandConnector('verify', {
            ...flags,
            quiet: true,
            json: false,
            'require-cloud': true,
            cloud: true
        });
        if (cloudVerifyCode === 0) {
            ready = true;
            break;
        }
        await deps.sleepMs(cloudWaitIntervalMs);
    }

    return { ready, attempts, elapsedMs: Date.now() - waitStartedAt };
}

export function createSetupCommands(
    deps: SetupCommandDeps,
    collectDoctorChecks: (flags: FlagMap) => Promise<{ checks: DoctorCheck[] }>
) {
    async function commandSetupValidate(flags: FlagMap): Promise<number> {
        const asJson = Boolean(flags.json);
        const quiet = Boolean(flags.quiet) || asJson;
        const requireCloud = Boolean(flags['require-cloud']);
        const waitCloudReady = Boolean(flags['wait-cloud-ready']);
        const cloudWaitTimeoutMs = deps.parsePositiveIntegerFlag(flags['cloud-wait-timeout-ms'], 60_000);
        const cloudWaitIntervalMs = deps.parsePositiveIntegerFlag(flags['cloud-wait-interval-ms'], 2_000);
        const steps: SetupStep[] = [];

        const token = deps.resolveToken();
        steps.push({
            id: 'auth_login',
            status: token ? 'pass' : 'fail',
            code: token ? 0 : 1,
            message: token ? 'Authentication available.' : 'No active authentication session found.'
        });

        const registration = deps.readConnectorState();
        steps.push({
            id: 'connector_state',
            status: registration ? 'pass' : 'warn',
            code: 0,
            message: registration
                ? 'Connector registration state exists.'
                : 'Connector registration state not found (setup will need to register this machine).'
        });

        try {
            const { checks } = await collectDoctorChecks({ ...flags, json: false });
            for (const check of checks) {
                steps.push({
                    id: `doctor_${check.id}`,
                    status: check.status,
                    code: statusToCode(check.status),
                    message: check.message
                });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            steps.push({
                id: 'doctor_checks',
                status: 'fail',
                code: 1,
                message: `Doctor checks failed to execute: ${message}`
            });
        }

        const verifyCode = await deps.commandConnector('verify', connectorVerifyFlags(flags, requireCloud));
        steps.push({
            id: 'connector_verify',
            status: verifyCode === 0 ? 'pass' : 'fail',
            code: verifyCode,
            message: verifyCode === 0 ? 'Connector verification passed.' : 'Connector verification failed.'
        });

        if (waitCloudReady || requireCloud) {
            if (!token || !registration) {
                steps.push({
                    id: 'cloud_ready',
                    status: 'fail',
                    code: 1,
                    message: 'Cloud-ready validation requires both authentication and connector registration.'
                });
            } else {
                const result = await waitForCloudReady(deps, flags, cloudWaitTimeoutMs, cloudWaitIntervalMs);
                steps.push({
                    id: 'cloud_ready',
                    status: result.ready ? 'pass' : 'fail',
                    code: result.ready ? 0 : 1,
                    message: result.ready
                        ? `Cloud-ready posture confirmed after ${result.attempts} attempt(s) in ${result.elapsedMs}ms.`
                        : `Cloud-ready posture not confirmed within ${result.elapsedMs}ms (${result.attempts} attempt(s)).`
                });
            }
        }

        const ok = steps.every(step => step.status !== 'fail');
        const dashboardUrl = deps.getHostedDashboardUrl();

        if (asJson) {
            printSetupJson(ok, steps, dashboardUrl);
            return ok ? 0 : 1;
        }

        if (!quiet) {
            console.log('\nSetup Validation\n');
            for (const step of steps) {
                console.log(`  ${step.status.padEnd(4)} ${step.id}: ${step.message}`);
            }
            console.log('');
            if (!ok) {
                console.log('Validation failed. Fix the failed checks, then rerun `0ctx setup --validate` or use `0ctx enable` inside a repo.');
                console.log('');
            }
        }

        return ok ? 0 : 1;
    }

    async function commandSetup(flags: FlagMap): Promise<number> {
        if (Boolean(flags.validate)) return commandSetupValidate(flags);

        const asJson = Boolean(flags.json);
        const quiet = Boolean(flags.quiet) || asJson;
        const skipService = Boolean(flags['skip-service']);
        const skipBootstrap = Boolean(flags['skip-bootstrap']);
        const skipHooks = Boolean(flags['skip-hooks']);
        const hooksDryRun = Boolean(flags['hooks-dry-run']);
        const requireCloud = Boolean(flags['require-cloud']);
        const waitCloudReady = Boolean(flags['wait-cloud-ready']);
        const cloudWaitTimeoutMs = deps.parsePositiveIntegerFlag(flags['cloud-wait-timeout-ms'], 60_000);
        const cloudWaitIntervalMs = deps.parsePositiveIntegerFlag(flags['cloud-wait-interval-ms'], 2_000);
        const createContextName = deps.parseOptionalStringFlag(flags['create-context']);
        const dashboardQueryInput = flags['dashboard-query'];
        const steps: SetupStep[] = [];
        const allowPreview = Boolean(flags['allow-preview']) || Boolean(flags.allowPreview);
        const previewError = deps.validateExplicitPreviewSelection(flags.clients, 'codex,cursor,windsurf');
        if (previewError) {
            console.error(previewError);
            return 1;
        }
        const previewOptInError = deps.validatePreviewOptIn(flags.clients, allowPreview, 'codex,cursor,windsurf');
        if (previewOptInError) {
            console.error(previewOptInError);
            return 1;
        }

        if (!quiet) console.log('Running setup workflow...');

        if (!deps.resolveToken()) {
            if (!quiet) console.log('auth: no active session found. Starting login...');
            const authCode = await deps.commandAuthLogin(flags);
            steps.push({ id: 'auth_login', status: authCode === 0 ? 'pass' : 'fail', code: authCode, message: authCode === 0 ? 'Authentication completed.' : 'Authentication failed.' });
            if (authCode !== 0) {
                if (asJson) printSetupJson(false, steps, deps.getHostedDashboardUrl());
                return authCode;
            }
        } else {
            if (!quiet) console.log('auth: already logged in');
            steps.push({ id: 'auth_login', status: 'pass', code: 0, message: 'Already authenticated.' });
        }

        if (skipService) {
            steps.push({ id: 'connector_service', status: 'warn', code: 0, message: 'Service installation/start was skipped by --skip-service.' });
        } else {
            for (const action of ['install', 'enable', 'start'] as const) {
                const code = await deps.commandConnector(action, { ...flags, quiet });
                steps.push({
                    id: `connector_service_${action}`,
                    status: code === 0 ? 'pass' : 'warn',
                    code,
                    message: code === 0 ? `Connector service ${action} succeeded.` : `Connector service ${action} failed; continuing with local runtime flow.`
                });
                if (code !== 0 && !quiet) console.log(`connector ${action}: warning (continuing with local runtime flow)`);
            }
        }

        const installCode = await deps.commandInstall({ ...flags, quiet, json: false, 'skip-bootstrap': skipBootstrap });
        steps.push({ id: 'install', status: installCode === 0 ? 'pass' : 'fail', code: installCode, message: installCode === 0 ? `Install workflow completed${skipBootstrap ? ' (bootstrap skipped).' : '.'}` : 'Install workflow failed.' });
        if (installCode !== 0) {
            if (asJson) printSetupJson(false, steps, deps.getHostedDashboardUrl());
            return installCode;
        }

        if (skipHooks) {
            steps.push({ id: 'hooks_install', status: 'warn', code: 0, message: 'Capture integration installation was skipped by --skip-hooks.' });
        } else {
            const hooksCode = await deps.commandConnectorHook('install', {
                ...flags,
                quiet: true,
                json: false,
                'repo-root': deps.parseOptionalStringFlag(flags['repo-root']) ?? process.cwd(),
                'dry-run': hooksDryRun
            });
            steps.push({
                id: 'hooks_install',
                status: hooksCode === 0 ? (hooksDryRun ? 'warn' : 'pass') : 'fail',
                code: hooksCode,
                message: hooksCode === 0 ? (hooksDryRun ? 'Capture integration installation dry-run completed.' : 'Capture integration installation completed.') : 'Capture integration installation failed.'
            });
            if (hooksCode !== 0) {
                if (asJson) printSetupJson(false, steps, deps.getHostedDashboardUrl());
                return hooksCode;
            }
        }

        const registerCode = await deps.commandConnector('register', { ...flags, quiet: true, json: false, 'require-cloud': requireCloud });
        steps.push({ id: 'connector_register', status: registerCode === 0 ? 'pass' : 'fail', code: registerCode, message: registerCode === 0 ? 'Connector registration completed.' : 'Connector registration failed.' });
        if (registerCode !== 0) {
            console.error('setup_register_failed: unable to register connector metadata');
            if (asJson) printSetupJson(false, steps, deps.getHostedDashboardUrl());
            return registerCode;
        }

        const verifyCode = await deps.commandConnector('verify', connectorVerifyFlags(flags, requireCloud));
        steps.push({ id: 'connector_verify', status: verifyCode === 0 ? 'pass' : 'fail', code: verifyCode, message: verifyCode === 0 ? 'Connector verification passed.' : 'Connector verification failed.' });
        if (verifyCode !== 0) {
            console.error('setup_verify_failed: connector/runtime verification failed');
            if (asJson) printSetupJson(false, steps, deps.getHostedDashboardUrl());
            return verifyCode;
        }

        if (waitCloudReady || requireCloud) {
            if (!quiet) console.log('cloud: waiting for connector cloud-ready posture...');
            const result = await waitForCloudReady(deps, flags, cloudWaitTimeoutMs, cloudWaitIntervalMs);
            steps.push({
                id: 'cloud_ready',
                status: result.ready ? 'pass' : 'fail',
                code: result.ready ? 0 : 1,
                message: result.ready ? `Cloud-ready posture confirmed after ${result.attempts} attempt(s) in ${result.elapsedMs}ms.` : `Cloud-ready posture not confirmed within ${result.elapsedMs}ms (${result.attempts} attempt(s)).`
            });
            if (!result.ready) {
                if (asJson) printSetupJson(false, steps, deps.getHostedDashboardUrl());
                else console.error('setup_cloud_ready_timeout: connector did not reach cloud-ready posture within timeout');
                return 1;
            }
        }

        let createdContextId: string | null = null;
        const setupRepoRoot = deps.resolveRepoRoot(null);
        if (createContextName) {
            try {
                const created = await deps.sendToDaemon<{ id?: string; contextId?: string }>('createContext', { name: createContextName, paths: [setupRepoRoot] });
                createdContextId = created?.id ?? created?.contextId ?? null;
                steps.push({ id: 'create_context', status: 'pass', code: 0, message: `Context created: ${createContextName} (${setupRepoRoot})` });
            } catch (error) {
                const errorText = error instanceof Error ? error.message : String(error);
                steps.push({ id: 'create_context', status: 'fail', code: 1, message: `Failed to create context '${createContextName}': ${errorText}` });
                if (asJson) printSetupJson(false, steps, deps.getHostedDashboardUrl());
                else console.error(`setup_create_context_failed: ${errorText}`);
                return 1;
            }
        }

        let dashboardQuery = deps.parseOptionalStringFlag(dashboardQueryInput);
        if (dashboardQueryInput !== undefined) {
            const parts = new URLSearchParams(dashboardQuery ?? '');
            const state = deps.readConnectorState();
            if (state) {
                parts.set('machineId', state.machineId);
                if (state.tenantId) parts.set('tenantId', state.tenantId);
                parts.set('registrationMode', state.registrationMode);
            }
            if (createContextName) parts.set('contextName', createContextName);
            if (createdContextId) parts.set('contextId', createdContextId);
            if (requireCloud) parts.set('requireCloud', '1');
            dashboardQuery = parts.toString();
        }

        const resolvedDashboardUrl = deps.applyDashboardQuery(deps.getHostedDashboardUrl(), dashboardQuery ?? undefined);
        const dashboardFlags = dashboardQuery ? { ...flags, 'dashboard-query': dashboardQuery } : flags;
        const dashboardCode = asJson ? 0 : await deps.commandDashboard(dashboardFlags);
        steps.push({ id: 'dashboard_handoff', status: dashboardCode === 0 ? 'pass' : 'fail', code: dashboardCode, message: dashboardCode === 0 ? 'Dashboard handoff completed.' : 'Dashboard handoff failed.' });

        if (asJson) printSetupJson(dashboardCode === 0, steps, resolvedDashboardUrl);
        return dashboardCode;
    }

    return { commandSetupValidate, commandSetup };
}
