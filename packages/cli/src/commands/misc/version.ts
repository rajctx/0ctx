import os from 'os';
import path from 'path';
import type { FlagMap, MiscCommandDeps } from './types';

export function createVersionCommand(deps: MiscCommandDeps) {
    return function commandVersion(flags: FlagMap = {}): number {
        const asJson = Boolean(flags.json);
        const verbose = Boolean(flags.verbose);
        const payload = {
            version: deps.CLI_VERSION,
            cliPath: process.argv[1] ? path.resolve(process.argv[1]) : __filename,
            node: process.version,
            platform: `${os.platform()}-${os.arch()}`
        };

        if (asJson) {
            console.log(JSON.stringify(payload, null, 2));
            return 0;
        }
        if (verbose) {
            console.log(`version: ${payload.version}`);
            console.log(`cli_path: ${payload.cliPath}`);
            console.log(`node: ${payload.node}`);
            console.log(`platform: ${payload.platform}`);
            return 0;
        }

        console.log(payload.version);
        return 0;
    };
}
