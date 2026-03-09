import os from 'os';
import type { ConnectorCommandDeps, FlagMap } from './types';

export function createConnectorStatusCommand(deps: ConnectorCommandDeps) {
    return async function commandConnectorStatus(flags: FlagMap): Promise<number> {
        const daemon = await deps.isDaemonReachable();
        const registration = deps.readConnectorState();
        const token = deps.resolveToken();
        const requireBridge = Boolean(flags['require-bridge']);
        const cloudRequired = registration?.registrationMode === 'cloud';
        const cloudProbeRequested = Boolean(flags.cloud) || cloudRequired;
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

        const cloud = {
            connected: false,
            required: cloudRequired,
            registrationId: registration?.cloud.registrationId ?? null,
            streamUrl: registration?.cloud.streamUrl ?? null,
            capabilities: registration?.cloud.capabilities ?? [],
            lastError: registration?.cloud.lastError ?? null,
            lastHeartbeatAt: registration?.cloud.lastHeartbeatAt ?? null
        };

        if (cloudProbeRequested && token && registration) {
            const capabilitiesResult = await deps.fetchConnectorCapabilities(token.accessToken, registration.machineId);
            if (capabilitiesResult.ok) {
                cloud.capabilities = capabilitiesResult.data?.capabilities
                    ?? capabilitiesResult.data?.features
                    ?? cloud.capabilities;
                cloud.connected = true;
                cloud.lastError = null;
            } else {
                cloud.connected = false;
                cloud.lastError = capabilitiesResult.error ?? 'cloud_capabilities_failed';
            }

            const heartbeatPayload = {
                machineId: registration.machineId,
                tenantId: registration.tenantId,
                posture: daemon.ok ? 'connected' : 'offline',
                daemonRunning: daemon.ok,
                syncEnabled: Boolean(sync?.enabled),
                syncRunning: Boolean(sync?.running),
                queue: sync?.queue
            } as const;
            const heartbeatResult = await deps.sendConnectorHeartbeat(token.accessToken, heartbeatPayload);
            if (heartbeatResult.ok) {
                cloud.lastHeartbeatAt = Date.now();
                if (!capabilitiesResult.ok) {
                    cloud.connected = true;
                    cloud.lastError = null;
                }
            } else {
                cloud.lastError = heartbeatResult.error ?? cloud.lastError ?? 'cloud_heartbeat_failed';
                if (cloudRequired) cloud.connected = false;
            }

            deps.writeConnectorState({
                ...registration,
                updatedAt: Date.now(),
                cloud: {
                    ...registration.cloud,
                    capabilities: cloud.capabilities,
                    lastHeartbeatAt: cloud.lastHeartbeatAt,
                    lastError: cloud.lastError
                }
            });
        }

        const posture = !daemon.ok
            ? 'offline'
            : (!token || !registration)
                ? 'degraded'
                : (cloudRequired && !cloud.connected)
                    ? 'degraded'
                    : (Boolean(registration.runtime.eventBridgeError) || Boolean(registration.runtime.commandBridgeError))
                        ? 'degraded'
                        : ((sync?.enabled === false || sync == null || sync?.running) ? 'connected' : 'degraded');
        const recoveryState = !daemon.ok
            ? 'blocked'
            : (!token || !registration)
                ? 'recovering'
                : (registration.runtime.eventQueueBackoff > 0
                    || Boolean(registration.runtime.eventBridgeError)
                    || Boolean(registration.runtime.commandBridgeError)
                    || Boolean(cloud.lastError))
                    ? 'backoff'
                    : 'healthy';

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
                tenantId: registration.tenantId,
                statePath: deps.getConnectorStatePath(),
                updatedAt: new Date(registration.updatedAt).toISOString(),
                runtime: {
                    eventBridgeSupported: registration.runtime.eventBridgeSupported,
                    eventBridgeError: registration.runtime.eventBridgeError,
                    lastEventSequence: registration.runtime.lastEventSequence,
                    lastEventSyncAt: registration.runtime.lastEventSyncAt ? new Date(registration.runtime.lastEventSyncAt).toISOString() : null,
                    commandBridgeSupported: registration.runtime.commandBridgeSupported,
                    commandBridgeError: registration.runtime.commandBridgeError,
                    lastCommandCursor: registration.runtime.lastCommandCursor,
                    lastCommandSyncAt: registration.runtime.lastCommandSyncAt ? new Date(registration.runtime.lastCommandSyncAt).toISOString() : null,
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
                tenantId: null,
                statePath: deps.getConnectorStatePath(),
                updatedAt: null,
                runtime: null
            },
            auth: {
                authenticated: Boolean(token),
                tenantId: token?.tenantId ?? null
            },
            cloud,
            sync: sync ?? {
                enabled: false,
                running: false,
                lastError: daemon.ok ? 'sync_status_unavailable' : 'daemon_unreachable',
                queue: { pending: 0, inFlight: 0, failed: 0, done: 0 }
            },
            dashboardUrl: deps.getHostedDashboardUrl()
        };

        const bridgeReasons: string[] = [];
        if (!payload.registration.registered || !payload.registration.runtime) {
            bridgeReasons.push('not_registered');
        } else {
            if (!payload.registration.runtime.eventBridgeSupported) bridgeReasons.push('bridge_not_supported');
            if (payload.registration.runtime.eventBridgeError) bridgeReasons.push('bridge_error');
            if (!payload.registration.runtime.commandBridgeSupported) bridgeReasons.push('command_bridge_not_supported');
            if (payload.registration.runtime.commandBridgeError) bridgeReasons.push('command_bridge_error');
            if (payload.registration.runtime.queue.backoff > 0) bridgeReasons.push('queue_backoff');
        }
        const bridge = { required: requireBridge, healthy: bridgeReasons.length === 0, reasons: bridgeReasons };
        const exitCode = (requireBridge && !bridge.healthy) ? 1 : (posture === 'connected' ? 0 : 1);

        if (Boolean(flags.json)) {
            console.log(JSON.stringify({ ...payload, bridge }, null, 2));
            return exitCode;
        }

        console.log('\nConnector Status\n');
        console.log(`  posture:      ${payload.posture}`);
        console.log(`  recovery:     ${payload.recoveryState}`);
        console.log(`  daemon:       ${payload.daemon.running ? 'running' : 'not running'}`);
        console.log(`  registration: ${payload.registration.registered ? 'registered' : 'not registered'}`);
        console.log(`  auth:         ${payload.auth.authenticated ? 'authenticated' : 'not authenticated'}`);
        console.log(`  cloud:        ${payload.cloud.connected ? 'connected' : (payload.cloud.required ? 'not connected' : 'optional')}`);
        console.log(`  dashboard:    ${payload.dashboardUrl}`);
        if (payload.registration.registered) {
            console.log(`  machine_id:   ${payload.registration.machineId}`);
            if (payload.registration.runtime) {
                console.log(`  event_bridge: supported=${payload.registration.runtime.eventBridgeSupported} sequence=${payload.registration.runtime.lastEventSequence}`);
                console.log(`  command_bridge: supported=${payload.registration.runtime.commandBridgeSupported} cursor=${payload.registration.runtime.lastCommandCursor}`);
                console.log(`  event_queue:  pending=${payload.registration.runtime.queue.pending} ready=${payload.registration.runtime.queue.ready} backoff=${payload.registration.runtime.queue.backoff}`);
                console.log(`  recovery_state: ${payload.registration.runtime.recoveryState} failures=${payload.registration.runtime.consecutiveFailures}`);
                if (payload.registration.runtime.lastEventSyncAt) console.log(`  event_sync:   ${payload.registration.runtime.lastEventSyncAt}`);
                if (payload.registration.runtime.eventBridgeError) console.log(`  event_error:  ${payload.registration.runtime.eventBridgeError}`);
                if (payload.registration.runtime.lastHealthyAt) console.log(`  last_healthy: ${payload.registration.runtime.lastHealthyAt}`);
                if (payload.registration.runtime.lastRecoveryAt) console.log(`  last_recovery:${payload.registration.runtime.lastRecoveryAt}`);
                if (payload.registration.runtime.lastCommandSyncAt) console.log(`  command_sync: ${payload.registration.runtime.lastCommandSyncAt}`);
                if (payload.registration.runtime.commandBridgeError) console.log(`  command_error: ${payload.registration.runtime.commandBridgeError}`);
            }
        }
        if (payload.cloud.registrationId) console.log(`  cloud_reg_id: ${payload.cloud.registrationId}`);
        if (payload.cloud.lastError) console.log(`  cloud_error:  ${payload.cloud.lastError}`);
        if (payload.sync) {
            console.log(`  sync:         enabled=${payload.sync.enabled} running=${payload.sync.running}`);
            if (payload.sync.lastError) console.log(`  sync_error:   ${payload.sync.lastError}`);
        }
        if (!payload.daemon.running && payload.daemon.error) {
            console.log(`  daemon_error: ${payload.daemon.error}`);
            for (const [idx, step] of payload.daemon.recoverySteps.entries()) {
                console.log(`  daemon_fix_${idx + 1}: ${step}`);
            }
        }
        if (requireBridge || !bridge.healthy) {
            console.log(`  bridge:       ${bridge.healthy ? 'healthy' : 'unhealthy'}`);
            if (!bridge.healthy) console.log(`  bridge_issue: ${bridge.reasons.join(',')}`);
        }
        console.log('');
        return exitCode;
    };
}
