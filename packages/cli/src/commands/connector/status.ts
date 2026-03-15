import type { ConnectorCommandDeps, FlagMap } from './types';

export function createConnectorStatusCommand(deps: ConnectorCommandDeps) {
    return async function commandConnectorStatus(flags: FlagMap): Promise<number> {
        const daemon = await deps.isDaemonReachable();
        const registration = deps.readConnectorState();
        let sync: {
            enabled: boolean;
            running: boolean;
            lastError: string | null;
            queue?: { pending: number; inFlight: number; failed: number; done: number };
        } | null = null;

        if (daemon.ok) {
            try {
                sync = await deps.sendToDaemon('syncStatus', {});
            } catch {
                sync = null;
            }
        }

        const posture = !daemon.ok
            ? 'offline'
            : !registration
                ? 'degraded'
                : registration.runtime.eventQueueBackoff > 0
                    ? 'degraded'
                    : ((sync?.enabled === false || sync == null || sync?.running) ? 'connected' : 'degraded');
        const recoveryState = !daemon.ok
            ? 'blocked'
            : !registration
                ? 'recovering'
                : registration.runtime.eventQueueBackoff > 0
                    ? 'backoff'
                    : (registration.runtime.recoveryState ?? 'healthy');

        const payload = {
            posture,
            recoveryState,
            daemon: {
                running: daemon.ok,
                error: daemon.ok ? null : (daemon.error ?? 'unknown'),
                recoverySteps: daemon.ok ? [] : deps.inferDaemonRecoverySteps(daemon.error)
            },
            registration: registration ? {
                registered: true,
                machineId: registration.machineId,
                statePath: deps.getConnectorStatePath(),
                updatedAt: new Date(registration.updatedAt).toISOString(),
                runtime: {
                    recoveryState: registration.runtime.recoveryState ?? recoveryState,
                    consecutiveFailures: registration.runtime.consecutiveFailures ?? 0,
                    lastHealthyAt: registration.runtime.lastHealthyAt ? new Date(registration.runtime.lastHealthyAt).toISOString() : null,
                    lastRecoveryAt: registration.runtime.lastRecoveryAt ? new Date(registration.runtime.lastRecoveryAt).toISOString() : null,
                    queue: {
                        pending: registration.runtime.eventQueuePending,
                        ready: registration.runtime.eventQueueReady,
                        backoff: registration.runtime.eventQueueBackoff
                    }
                }
            } : {
                registered: false,
                machineId: null,
                statePath: deps.getConnectorStatePath(),
                updatedAt: null,
                runtime: null
            },
            sync: sync ?? {
                enabled: false,
                running: false,
                lastError: daemon.ok ? 'sync_status_unavailable' : 'daemon_unreachable',
                queue: { pending: 0, inFlight: 0, failed: 0, done: 0 }
            },
            hostedUrl: deps.getHostedUiUrl()
        };

        const exitCode = posture === 'connected' ? 0 : 1;

        if (Boolean(flags.json)) {
            console.log(JSON.stringify(payload, null, 2));
            return exitCode;
        }

        console.log('\nConnector Status\n');
        console.log(`  posture:      ${payload.posture}`);
        console.log(`  recovery:     ${payload.recoveryState}`);
        console.log(`  daemon:       ${payload.daemon.running ? 'running' : 'not running'}`);
        console.log(`  registration: ${payload.registration.registered ? 'registered' : 'not registered'}`);
        console.log('  mode:         local');
        console.log(`  hosted:       ${payload.hostedUrl}`);
        if (payload.registration.registered && payload.registration.runtime) {
            console.log(`  machine_id:   ${payload.registration.machineId}`);
            console.log(`  event_queue:  pending=${payload.registration.runtime.queue.pending} ready=${payload.registration.runtime.queue.ready} backoff=${payload.registration.runtime.queue.backoff}`);
            console.log(`  recovery_state: ${payload.registration.runtime.recoveryState} failures=${payload.registration.runtime.consecutiveFailures}`);
            if (payload.registration.runtime.lastHealthyAt) console.log(`  last_healthy: ${payload.registration.runtime.lastHealthyAt}`);
            if (payload.registration.runtime.lastRecoveryAt) console.log(`  last_recovery:${payload.registration.runtime.lastRecoveryAt}`);
        }
        console.log(`  sync:         enabled=${payload.sync.enabled} running=${payload.sync.running}`);
        if (payload.sync.lastError) console.log(`  sync_error:   ${payload.sync.lastError}`);
        if (!payload.daemon.running && payload.daemon.error) {
            console.log(`  daemon_error: ${payload.daemon.error}`);
            for (const [idx, step] of payload.daemon.recoverySteps.entries()) {
                console.log(`  daemon_fix_${idx + 1}: ${step}`);
            }
        }
        console.log('');
        return exitCode;
    };
}
