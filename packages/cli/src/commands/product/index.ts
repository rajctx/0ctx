import type { ProductCommandDeps } from './types';
import { createStatusCommands } from './status';
import { createBootstrapCommands } from './bootstrap';
import { createEnableCommands } from './enable';
import { createUtilityCommands } from './utilities';

export type { ProductCommandDeps, FlagMap } from './types';

export function createProductCommands(deps: ProductCommandDeps) {
    const bootstrap = createBootstrapCommands(deps);
    return {
        ...createStatusCommands(deps),
        ...bootstrap,
        ...createEnableCommands({ ...deps, commandBootstrap: bootstrap.commandBootstrap }),
        ...createUtilityCommands(deps)
    };
}
