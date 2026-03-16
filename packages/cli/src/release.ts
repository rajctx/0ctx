import type { ReleaseStepResult, RunMode } from './release/process.js';
import { buildNpmRunArgs, getNpmCommand, resolveReleaseRepoRoot, runNpmScript, runPublishScript } from './release/process.js';
import { bumpAllPackageVersions, normalizeReleaseVersion, validateReleaseVersion } from './release/versioning.js';

export interface ReleasePublishOptions {
    version: string;
    tag?: string;
    dryRun?: boolean;
    allowDirty?: boolean;
    otp?: string;
    skipValidate?: boolean;
    skipChangelog?: boolean;
    outputMode?: RunMode;
}

export interface ReleasePublishResult {
    ok: boolean;
    repoRoot: string;
    version: string;
    tag: string;
    dryRun: boolean;
    steps: ReleaseStepResult[];
}

export type { ReleaseStepResult, RunMode } from './release/process.js';
export { bumpAllPackageVersions, normalizeReleaseVersion, validateReleaseVersion } from './release/versioning.js';

export async function runReleasePublish(options: ReleasePublishOptions): Promise<ReleasePublishResult> {
    const repoRoot = resolveReleaseRepoRoot();
    const version = validateReleaseVersion(options.version);
    const tag = (options.tag || 'latest').trim() || 'latest';
    const dryRun = Boolean(options.dryRun);
    const outputMode = options.outputMode ?? 'inherit';
    const steps: ReleaseStepResult[] = [];

    const pushAndCheck = async (resultPromise: Promise<ReleaseStepResult>): Promise<boolean> => {
        const result = await resultPromise;
        steps.push(result);
        return result.ok;
    };

    // --- Version bump (first step) ---
    {
        const startedAt = Date.now();
        try {
            const bumpResult = bumpAllPackageVersions(repoRoot, version);
            const stdout = `Bumped versions:\n${bumpResult.bumped.join('\n')}`;
            if (outputMode === 'inherit') {
                console.log('');
                console.log('==> Version bump');
                console.log(stdout);
            }
            steps.push({
                id: 'version_bump',
                ok: true,
                command: 'bumpAllPackageVersions',
                args: [version],
                exitCode: 0,
                stdout,
                stderr: '',
                durationMs: Date.now() - startedAt
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            steps.push({
                id: 'version_bump',
                ok: false,
                command: 'bumpAllPackageVersions',
                args: [version],
                exitCode: 1,
                stdout: '',
                stderr: message,
                durationMs: Date.now() - startedAt
            });
            return { ok: false, repoRoot, version, tag, dryRun, steps };
        }
    }

    if (!options.skipValidate) {
        const validateArgs: string[] = [];
        if (dryRun) validateArgs.push('-DryRun');
        if (options.allowDirty) validateArgs.push('-AllowDirty');
        const ok = await pushAndCheck(runNpmScript('validate', 'release:validate', validateArgs, repoRoot, outputMode));
        if (!ok) {
            return { ok: false, repoRoot, version, tag, dryRun, steps };
        }
    } else {
        steps.push({
            id: 'validate',
            ok: true,
            skipped: true,
            command: getNpmCommand(),
            args: buildNpmRunArgs('release:validate'),
            exitCode: 0,
            stdout: '',
            stderr: '',
            durationMs: 0
        });
    }

    if (!options.skipChangelog) {
        const changelogArgs = ['-Version', version];
        if (dryRun) changelogArgs.push('-DryRun');
        const ok = await pushAndCheck(
            runNpmScript('changelog', 'release:changelog:prepare', changelogArgs, repoRoot, outputMode)
        );
        if (!ok) {
            return { ok: false, repoRoot, version, tag, dryRun, steps };
        }
    } else {
        steps.push({
            id: 'changelog',
            ok: true,
            skipped: true,
            command: getNpmCommand(),
            args: buildNpmRunArgs('release:changelog:prepare'),
            exitCode: 0,
            stdout: '',
            stderr: '',
            durationMs: 0
        });
    }

    {
        const ok = await pushAndCheck(
            runNpmScript('tag_preview', 'release:tag:dry', ['-Version', version], repoRoot, outputMode)
        );
        if (!ok) {
            return { ok: false, repoRoot, version, tag, dryRun, steps };
        }
    }

    {
        const ok = await pushAndCheck(runNpmScript('pack_dry', 'release:pack:dry', [], repoRoot, outputMode));
        if (!ok) {
            return { ok: false, repoRoot, version, tag, dryRun, steps };
        }
    }

    {
        const ok = await pushAndCheck(runNpmScript('pack_verify', 'release:pack:verify', [], repoRoot, outputMode));
        if (!ok) {
            return { ok: false, repoRoot, version, tag, dryRun, steps };
        }
    }

    {
        const ok = await pushAndCheck(
            runPublishScript(
                'publish',
                {
                    repoRoot,
                    dryRun,
                    allowDirty: options.allowDirty,
                    otp: options.otp,
                    tag
                },
                outputMode
            )
        );
        if (!ok) {
            return { ok: false, repoRoot, version, tag, dryRun, steps };
        }
    }

    return {
        ok: true,
        repoRoot,
        version,
        tag,
        dryRun,
        steps
    };
}
