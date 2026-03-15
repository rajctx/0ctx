import os from 'os';
import type { ConnectorCommandDeps, FlagMap } from './types';

export function createConnectorRegisterCommand(deps: ConnectorCommandDeps) {
    return async function commandConnectorRegister(flags: FlagMap): Promise<number> {
        const asJson = Boolean(flags.json);
        const force = Boolean(flags.force);
        const hostedUiUrl = deps.getHostedUiUrl();
        const { state, created } = deps.registerConnector({
            uiUrl: hostedUiUrl,
            force
        });

        const payload = {
            ok: true,
            created,
            machineId: state.machineId,
            hostedUrl: state.uiUrl,
            platform: os.platform(),
            statePath: deps.getConnectorStatePath()
        };

        if (asJson) {
            console.log(JSON.stringify(payload, null, 2));
        } else if (!Boolean(flags.quiet)) {
            console.log(`connector_registration: ${created ? 'created' : 'existing'}`);
            console.log(`machine_id: ${state.machineId}`);
            console.log(`hosted_url: ${state.uiUrl}`);
            console.log(`platform: ${os.platform()}`);
            console.log(`state_path: ${deps.getConnectorStatePath()}`);
        }

        return 0;
    };
}
