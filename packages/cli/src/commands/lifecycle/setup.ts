import type { FlagMap, SetupCommandDeps, SetupStep } from './types';
import type { DoctorCheck } from './types';

function statusToCode(status: SetupStep['status']): number {
    return status === 'fail' ? 1 : 0;
}

function printSetupJson(ok: boolean, steps: SetupStep[]): void {
    console.log(JSON.stringify({ ok, steps }, null, 2));
}

function connectorVerifyFlags(flags: FlagMap): FlagMap {
    return {
        ...flags,
        quiet: true,
        json: false
    };
}

export function createSetupCommands(
    deps: SetupCommandDeps,
    collectDoctorChecks: (flags: FlagMap) => Promise<{ checks: DoctorCheck[] }>
) {
    async function commandSetupValidate(flags: FlagMap): Promise<number> {
        const asJson = Boolean(flags.json);
        const quiet = Boolean(flags.quiet) || asJson;
        const steps: SetupStep[] = [];

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

        const verifyCode = await deps.commandConnector('verify', connectorVerifyFlags(flags));
        steps.push({
            id: 'connector_verify',
            status: verifyCode === 0 ? 'pass' : 'fail',
            code: verifyCode,
            message: verifyCode === 0 ? 'Connector verification passed.' : 'Connector verification failed.'
        });

        const ok = steps.every(step => step.status !== 'fail');

        if (asJson) {
            printSetupJson(ok, steps);
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
        const createContextName = deps.parseOptionalStringFlag(flags['create-context']);
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
            if (asJson) printSetupJson(false, steps);
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
                if (asJson) printSetupJson(false, steps);
                return hooksCode;
            }
        }

        const registerCode = await deps.commandConnector('register', { ...flags, quiet: true, json: false });
        steps.push({ id: 'connector_register', status: registerCode === 0 ? 'pass' : 'fail', code: registerCode, message: registerCode === 0 ? 'Connector registration completed.' : 'Connector registration failed.' });
        if (registerCode !== 0) {
            console.error('setup_register_failed: unable to register connector metadata');
            if (asJson) printSetupJson(false, steps);
            return registerCode;
        }

        const verifyCode = await deps.commandConnector('verify', connectorVerifyFlags(flags));
        steps.push({ id: 'connector_verify', status: verifyCode === 0 ? 'pass' : 'fail', code: verifyCode, message: verifyCode === 0 ? 'Connector verification passed.' : 'Connector verification failed.' });
        if (verifyCode !== 0) {
            console.error('setup_verify_failed: connector/runtime verification failed');
            if (asJson) printSetupJson(false, steps);
            return verifyCode;
        }

        const setupRepoRoot = deps.resolveRepoRoot(null);
        if (createContextName) {
            try {
                await deps.sendToDaemon<{ id?: string; contextId?: string }>('createContext', { name: createContextName, paths: [setupRepoRoot] });
                steps.push({ id: 'create_context', status: 'pass', code: 0, message: `Context created: ${createContextName} (${setupRepoRoot})` });
            } catch (error) {
                const errorText = error instanceof Error ? error.message : String(error);
                steps.push({ id: 'create_context', status: 'fail', code: 1, message: `Failed to create context '${createContextName}': ${errorText}` });
                if (asJson) printSetupJson(false, steps);
                else console.error(`setup_create_context_failed: ${errorText}`);
                return 1;
            }
        }
        const ok = steps.every(step => step.status !== 'fail');
        if (asJson) printSetupJson(ok, steps);
        return ok ? 0 : 1;
    }

    return { commandSetupValidate, commandSetup };
}
