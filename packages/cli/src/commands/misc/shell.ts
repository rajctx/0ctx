import type { MiscCommandDeps } from './types';

export function createShellCommand(deps: MiscCommandDeps) {
    return async function commandShell(): Promise<number> {
        return deps.runInteractiveShell({
            cliEntrypoint: deps.resolveCliEntrypoint(),
            nodeExecArgv: process.execArgv
        });
    };
}
