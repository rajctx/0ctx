import type { ConnectorCommandDeps, FlagMap } from './types';

export function createConnectorVerifyCommand(deps: ConnectorCommandDeps) {
    return async function commandConnectorVerify(flags: FlagMap): Promise<number> {
        const daemon = await deps.isDaemonReachable();
        const registration = deps.readConnectorState();
        const token = deps.resolveToken();
        const requireCloud = Boolean(flags.cloud) || Boolean(flags['require-cloud']);
        const asJson = Boolean(flags.json);
        let cloudOk = !requireCloud;
        let cloudError: string | null = null;

        if (requireCloud && token && registration) {
            const cloudCapabilities = await deps.fetchConnectorCapabilities(token.accessToken, registration.machineId);
            cloudOk = cloudCapabilities.ok;
            cloudError = cloudCapabilities.ok ? null : (cloudCapabilities.error ?? 'cloud_capabilities_check_failed');
        } else if (requireCloud && (!token || !registration)) {
            cloudOk = false;
            cloudError = 'cloud_verification_requires_auth_and_registration';
        }

        const checks = {
            daemon: daemon.ok,
            registration: Boolean(registration),
            auth: Boolean(token),
            cloud: cloudOk
        };

        const ok = checks.daemon && checks.registration && checks.auth && checks.cloud;
        const payload = {
            ok,
            requireCloud,
            checks,
            machineId: registration?.machineId ?? null,
            daemonError: daemon.ok ? null : (daemon.error ?? 'unknown'),
            cloudError
        };

        if (asJson) {
            console.log(JSON.stringify(payload, null, 2));
        } else if (!Boolean(flags.quiet)) {
            console.log('\nConnector Verify\n');
            console.log(`  daemon:       ${checks.daemon ? 'ok' : 'missing'}`);
            console.log(`  registration: ${checks.registration ? 'ok' : 'missing'}`);
            console.log(`  auth:         ${checks.auth ? 'ok' : 'missing'}`);
            if (requireCloud) console.log(`  cloud:        ${checks.cloud ? 'ok' : 'missing'}`);
            if (registration) console.log(`  machine_id:   ${registration.machineId}`);
            if (!daemon.ok && daemon.error) console.log(`  daemon_error: ${daemon.error}`);
            if (requireCloud && cloudError) console.log(`  cloud_error:  ${cloudError}`);
            console.log('');
        }

        return ok ? 0 : 1;
    };
}
