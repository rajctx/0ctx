import type { HookCommandDeps } from './types';
import { createHookInstallCommand } from './install';
import { createHookStatusCommand } from './status';
import { createHookPruneCommand } from './prune';
import { createHookSessionStartCommand } from './session-start';
import { createHookMainCommand } from './main';
import { createHookIngestCommand } from './ingest';

export function createHookCommands(deps: HookCommandDeps) {
    const commandInstall = createHookInstallCommand(deps);
    const commandStatus = createHookStatusCommand(deps);
    const commandPrune = createHookPruneCommand(deps);
    const commandSessionStart = createHookSessionStartCommand(deps);
    const commandIngest = createHookIngestCommand(deps);
    const commandHook = createHookMainCommand(deps);

    return {
        commandHook,
        commandInstall,
        commandStatus,
        commandPrune,
        commandSessionStart,
        commandIngest
    };
}
