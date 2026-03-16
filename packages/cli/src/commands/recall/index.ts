import type { RecallCommandDeps } from './types';
import { createRecallCommand } from './main';

export type { FlagMap, RecallCommandDeps } from './types';

export function createRecallCommands(deps: RecallCommandDeps) {
    return {
        commandRecall: createRecallCommand(deps)
    };
}
