import { isGaHookAgent } from '../../../cli-core/clients';
import type { HookSupportedAgent } from '../../../cli-core/types';
import type { HookCommandDeps, FlagMap } from './types';

export function createHookStatusCommand(deps: HookCommandDeps) {
    return async function commandHookStatus(flags: FlagMap): Promise<number> {
        const asJson = Boolean(flags.json);
        const quiet = Boolean(flags.quiet) || asJson;
        const includePreview = Boolean(flags['include-preview']) || Boolean(flags['include-explicit']) || Boolean(flags.all);
        const state = deps.readHookInstallState();
        const gaAgents = state.agents.filter((agent) => isGaHookAgent(agent.agent as HookSupportedAgent));
        const previewAgents = state.agents.filter((agent) => !isGaHookAgent(agent.agent as HookSupportedAgent));
        const visibleAgents = includePreview ? state.agents : gaAgents;
        if (asJson) {
            console.log(JSON.stringify({
                ...state,
                agents: visibleAgents,
                previewAgents: includePreview ? previewAgents : []
            }, null, 2));
            return 0;
        }

        if (!quiet) {
            console.log('\nConnector Hook Status\n');
            console.log(`  project_root:   ${state.projectRoot ?? 'n/a'}`);
            console.log(`  project_config: ${state.projectConfigPath ?? 'n/a'}`);
            console.log(`  updated_at:     ${new Date(state.updatedAt).toISOString()}`);
            for (const agent of visibleAgents) {
                console.log(`  ${agent.agent}: ${agent.status}${agent.installed ? ' (installed)' : ''}`);
            }
            if (!includePreview && previewAgents.some((agent) => agent.installed)) {
                console.log('  non_ga: hidden (use --include-explicit to inspect explicit opt-in installs)');
            }
            console.log('');
        }
        return 0;
    };
}
