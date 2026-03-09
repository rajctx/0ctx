import type { MiscCommandDeps } from './types';
import { createShellCommand } from './shell';
import { createReleasePublishCommand } from './release';
import { createVersionCommand } from './version';
import { createConfigCommands } from './config';

export type { FlagMap, MiscCommandDeps } from './types';

export function createMiscCommands(deps: MiscCommandDeps) {
    return {
        commandShell: createShellCommand(deps),
        commandReleasePublish: createReleasePublishCommand(deps),
        commandVersion: createVersionCommand(deps),
        ...createConfigCommands(deps)
    };
}
