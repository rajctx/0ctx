import type { HookCommandDeps, FlagMap } from './types';

export function createHookPruneCommand(deps: HookCommandDeps) {
    return async function commandHookPrune(flags: FlagMap): Promise<number> {
        const asJson = Boolean(flags.json);
        const quiet = Boolean(flags.quiet) || asJson;
        const maxAgeDays = deps.parsePositiveIntegerFlag(flags.days ?? flags['retention-days'], deps.getHookDumpRetentionDays());
        const result = deps.pruneHookDumps({ maxAgeDays });
        if (asJson) {
            console.log(JSON.stringify({ ok: true, ...result }, null, 2));
        } else if (!quiet) {
            console.log('\nHook Dump Prune\n');
            console.log(`  root:           ${result.rootDir}`);
            console.log(`  retention_days: ${result.maxAgeDays}`);
            console.log(`  debug_policy:   ${result.debugArtifactsEnabled ? `${result.debugMaxAgeDays}d retention` : 'disabled (all debug trails purged)'}`);
            console.log(`  deleted_files:  ${result.deletedFiles}`);
            console.log(`  deleted_dirs:   ${result.deletedDirs}`);
            console.log(`  reclaimed:      ${result.reclaimedBytes} bytes`);
            console.log('');
        }
        return 0;
    };
}
