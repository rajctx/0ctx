import type { HealthCommandDeps, SetupCommandDeps, ResetCommandDeps } from './types';
import { createHealthCommands } from './health';
import { createSetupCommands } from './setup';
import { createResetCommand } from './reset';

export type { FlagMap, HealthCommandDeps, SetupCommandDeps, ResetCommandDeps } from './types';

export function createLifecycleCommands(deps: HealthCommandDeps & SetupCommandDeps & ResetCommandDeps) {
    const health = createHealthCommands(deps);
    return {
        ...health,
        ...createSetupCommands(deps, health.collectDoctorChecks),
        commandReset: createResetCommand(deps)
    };
}
