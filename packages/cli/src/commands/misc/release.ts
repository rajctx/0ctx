import type { FlagMap, MiscCommandDeps } from './types';

export function createReleasePublishCommand(deps: MiscCommandDeps) {
    return async function commandReleasePublish(flags: FlagMap): Promise<number> {
        const versionRaw = deps.parseOptionalStringFlag(flags.version);
        if (!versionRaw) {
            console.error('Missing required --version argument.');
            console.error('Usage: 0ctx release publish --version vX.Y.Z [--tag latest] [--otp 123456] [--dry-run] [--allow-dirty] [--json]');
            return 1;
        }

        const result = await deps.runReleasePublish({
            version: versionRaw,
            tag: deps.parseOptionalStringFlag(flags.tag) ?? 'latest',
            dryRun: Boolean(flags['dry-run']),
            allowDirty: Boolean(flags['allow-dirty']),
            otp: deps.parseOptionalStringFlag(flags.otp) ?? undefined,
            skipValidate: Boolean(flags['skip-validate']),
            skipChangelog: Boolean(flags['skip-changelog']),
            outputMode: Boolean(flags.json) ? 'capture' : 'inherit'
        });

        if (Boolean(flags.json)) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log(`release_publish: ${result.ok ? 'success' : 'failed'}`);
            console.log(`version: ${result.version}`);
            console.log(`tag: ${result.tag}`);
            console.log(`dry_run: ${result.dryRun}`);
            if (!result.ok) {
                const failedStep = result.steps.find(step => !step.ok);
                if (failedStep) console.error(`failed_step: ${failedStep.id} (exit=${failedStep.exitCode ?? 'unknown'})`);
            }
        }

        return result.ok ? 0 : 1;
    };
}
