import type { CommandDeps } from './types';
import { createWorkstreamCommandContext } from './shared';
import { createBranchCommands } from './workstreams';
import { createSessionCommands } from './sessions';
import { createCheckpointCommands } from './checkpoints';
import { createInsightCommands } from './insights';

export type { CommandDeps, FlagMap } from './types';

export function createWorkstreamCommands(deps: CommandDeps) {
    const ctx = createWorkstreamCommandContext(deps);
    return {
        ...createBranchCommands(ctx),
        ...createSessionCommands(ctx),
        ...createCheckpointCommands(ctx),
        ...createInsightCommands(ctx)
    };
}
