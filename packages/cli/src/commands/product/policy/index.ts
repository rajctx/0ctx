import type { PolicyCommandDeps } from './types';
import { createDataPolicyCommands } from './data-policy';
import { createSyncCommands } from './sync';

export type { FlagMap, PolicyCommandDeps } from './types';

export function createPolicyCommands(deps: PolicyCommandDeps) {
    return {
        ...createDataPolicyCommands(deps),
        ...createSyncCommands(deps)
    };
}
