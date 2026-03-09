import type { HookCommandDeps, FlagMap } from './types';
import { createHookInstallCommand } from './install';
import { createHookStatusCommand } from './status';
import { createHookPruneCommand } from './prune';
import { createHookSessionStartCommand } from './session-start';
import { createHookIngestCommand } from './ingest';

export function createHookMainCommand(deps: HookCommandDeps) {
    const commandInstall = createHookInstallCommand(deps);
    const commandStatus = createHookStatusCommand(deps);
    const commandPrune = createHookPruneCommand(deps);
    const commandSessionStart = createHookSessionStartCommand(deps);
    const commandIngest = createHookIngestCommand(deps);

    return async function commandHook(action: string | undefined, flags: FlagMap): Promise<number> {
        const safeAction = action ?? 'status';
        const validActions = ['install', 'status', 'ingest', 'prune', 'session-start'];
        if (!validActions.includes(safeAction)) {
            console.error(`Unknown connector hook action: '${action ?? ''}'`);
            console.error(`Valid actions: ${validActions.join(', ')}`);
            return 1;
        }

        if (safeAction === 'install') return commandInstall(flags);
        if (safeAction === 'status') return commandStatus(flags);
        if (safeAction === 'prune') return commandPrune(flags);

        const rawAgentFlag = deps.parseOptionalStringFlag(flags.agent)?.trim().toLowerCase() ?? null;
        const agent = deps.extractSupportedHookAgent(rawAgentFlag);
        if (!agent) {
            console.error("connector_hook_ingest_requires_agent: pass --agent=claude|windsurf|codex|cursor|factory|antigravity");
            return 1;
        }

        if (safeAction === 'session-start') {
            const payloadText = deps.parseOptionalStringFlag(flags.payload) ?? deps.readStdinPayload();
            let parsedPayload: unknown = {};
            if (payloadText && payloadText.trim().length > 0) {
                parsedPayload = (() => {
                    try {
                        return JSON.parse(payloadText);
                    } catch {
                        return { content: payloadText };
                    }
                })();
            }
            return commandSessionStart(agent, flags, deps.asRecord(parsedPayload) ?? {});
        }

        return commandIngest(agent, flags);
    };
}
