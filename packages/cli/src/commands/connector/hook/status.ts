import type { HookCommandDeps, FlagMap } from './types';

export function createHookStatusCommand(deps: HookCommandDeps) {
    return async function commandHookStatus(flags: FlagMap): Promise<number> {
        const asJson = Boolean(flags.json);
        const quiet = Boolean(flags.quiet) || asJson;
        const state = deps.readHookInstallState();
        if (asJson) {
            console.log(JSON.stringify(state, null, 2));
            return 0;
        }

        if (!quiet) {
            console.log('\nConnector Hook Status\n');
            console.log(`  project_root:   ${state.projectRoot ?? 'n/a'}`);
            console.log(`  project_config: ${state.projectConfigPath ?? 'n/a'}`);
            console.log(`  updated_at:     ${new Date(state.updatedAt).toISOString()}`);
            for (const agent of state.agents) {
                console.log(`  ${agent.agent}: ${agent.status}${agent.installed ? ' (installed)' : ''}`);
            }
            console.log('');
        }
        return 0;
    };
}
