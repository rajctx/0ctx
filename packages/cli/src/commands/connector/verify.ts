import type { ConnectorCommandDeps, FlagMap } from './types';

export function createConnectorVerifyCommand(deps: ConnectorCommandDeps) {
    return async function commandConnectorVerify(flags: FlagMap): Promise<number> {
        const daemon = await deps.isDaemonReachable();
        const registration = deps.readConnectorState();
        const asJson = Boolean(flags.json);

        const checks = {
            daemon: daemon.ok,
            registration: Boolean(registration)
        };

        const ok = checks.daemon && checks.registration;
        const payload = {
            ok,
            checks,
            machineId: registration?.machineId ?? null,
            daemonError: daemon.ok ? null : (daemon.error ?? 'unknown')
        };

        if (asJson) {
            console.log(JSON.stringify(payload, null, 2));
        } else if (!Boolean(flags.quiet)) {
            console.log('\nConnector Verify\n');
            console.log(`  daemon:       ${checks.daemon ? 'ok' : 'missing'}`);
            console.log(`  registration: ${checks.registration ? 'ok' : 'missing'}`);
            if (registration) console.log(`  machine_id:   ${registration.machineId}`);
            if (!daemon.ok && daemon.error) console.log(`  daemon_error: ${daemon.error}`);
            console.log('');
        }

        return ok ? 0 : 1;
    };
}
