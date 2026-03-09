import os from 'os';
import type { ConnectorCommandDeps, FlagMap } from './types';

export function createConnectorRegisterCommand(deps: ConnectorCommandDeps) {
    return async function commandConnectorRegister(flags: FlagMap): Promise<number> {
        const asJson = Boolean(flags.json);
        const token = deps.resolveToken();
        if (!token) {
            console.error('connector_register_requires_auth: run `0ctx auth login` first.');
            if (asJson) {
                console.log(JSON.stringify({
                    ok: false,
                    error: 'connector_register_requires_auth',
                    message: 'run `0ctx auth login` first.'
                }, null, 2));
            }
            return 1;
        }

        const force = Boolean(flags.force);
        const localOnly = Boolean(flags['local-only']);
        const requireCloud = Boolean(flags['require-cloud']);
        const dashboardUrl = deps.getHostedDashboardUrl();
        const { state: localState, created } = deps.registerConnector({
            tenantId: token.tenantId || null,
            uiUrl: dashboardUrl,
            force
        });

        let state = localState;
        let cloudError: string | null = null;
        let cloudRegistrationStatus: 'skipped' | 'connected' | 'local_fallback' = 'skipped';

        if (!localOnly) {
            const cloudResult = await deps.registerConnectorInCloud(token.accessToken, {
                machineId: localState.machineId,
                tenantId: token.tenantId || null,
                uiUrl: dashboardUrl,
                platform: os.platform()
            });

            if (cloudResult.ok) {
                cloudRegistrationStatus = 'connected';
                state = {
                    ...localState,
                    tenantId: cloudResult.data?.tenantId ?? localState.tenantId,
                    updatedAt: Date.now(),
                    registrationMode: 'cloud',
                    cloud: {
                        registrationId: cloudResult.data?.registrationId ?? localState.cloud.registrationId,
                        streamUrl: cloudResult.data?.streamUrl ?? localState.cloud.streamUrl,
                        capabilities: cloudResult.data?.capabilities ?? localState.cloud.capabilities,
                        lastHeartbeatAt: localState.cloud.lastHeartbeatAt,
                        lastError: null
                    }
                };
            } else {
                cloudRegistrationStatus = 'local_fallback';
                cloudError = cloudResult.error ?? 'cloud_registration_failed';
                state = {
                    ...localState,
                    updatedAt: Date.now(),
                    registrationMode: 'local',
                    cloud: {
                        ...localState.cloud,
                        lastError: cloudError
                    }
                };
            }

            deps.writeConnectorState(state);
        }

        const payload = {
            ok: true,
            created,
            machineId: state.machineId,
            tenantId: state.tenantId ?? null,
            dashboardUrl: state.uiUrl,
            registrationMode: state.registrationMode,
            cloudRegistration: cloudRegistrationStatus,
            cloudRegistrationId: state.cloud.registrationId ?? null,
            cloudStreamUrl: state.cloud.streamUrl ?? null,
            cloudError,
            statePath: deps.getConnectorStatePath()
        };

        if (asJson) {
            console.log(JSON.stringify(payload, null, 2));
        } else if (!Boolean(flags.quiet)) {
            console.log(`connector_registration: ${created ? 'created' : 'existing'}`);
            console.log(`machine_id: ${state.machineId}`);
            console.log(`tenant_id: ${state.tenantId ?? 'n/a'}`);
            console.log(`dashboard_url: ${state.uiUrl}`);
            console.log(`registration_mode: ${state.registrationMode}`);
            console.log(`cloud_registration: ${cloudRegistrationStatus}`);
            if (state.cloud.registrationId) console.log(`cloud_registration_id: ${state.cloud.registrationId}`);
            if (state.cloud.streamUrl) console.log(`cloud_stream_url: ${state.cloud.streamUrl}`);
            if (cloudError) console.log(`cloud_error: ${cloudError}`);
            console.log(`state_path: ${deps.getConnectorStatePath()}`);
        }

        if (requireCloud && state.registrationMode !== 'cloud') {
            console.error('connector_register_cloud_required: unable to register with cloud control plane');
            if (asJson) {
                console.log(JSON.stringify({
                    ...payload,
                    ok: false,
                    error: 'connector_register_cloud_required'
                }, null, 2));
            }
            return 1;
        }

        return 0;
    };
}
