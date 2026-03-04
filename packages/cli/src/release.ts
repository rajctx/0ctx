import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

type RunMode = 'inherit' | 'capture';

export interface ProcessRunResult {
    ok: boolean;
    command: string;
    args: string[];
    exitCode: number | null;
    stdout: string;
    stderr: string;
    durationMs: number;
}

export interface ReleaseStepResult extends ProcessRunResult {
    id: string;
    skipped?: boolean;
}

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

export function normalizeReleaseVersion(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) throw new Error('Missing required version (expected vX.Y.Z).');
    return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

export function validateReleaseVersion(input: string): string {
    const normalized = normalizeReleaseVersion(input);
    if (!/^v\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(normalized)) {
        throw new Error(`Invalid version '${input}'. Expected vX.Y.Z or vX.Y.Z-prerelease.`);
    }
    return normalized;
}

const WORKSPACE_PACKAGES = ['core', 'daemon', 'mcp', 'cli'] as const;

export interface VersionBumpResult {
    bumped: string[];
    version: string;
}

export function bumpAllPackageVersions(repoRoot: string, taggedVersion: string): VersionBumpResult {
    const bareVersion = taggedVersion.startsWith('v') ? taggedVersion.slice(1) : taggedVersion;
    const bumped: string[] = [];

    for (const pkg of WORKSPACE_PACKAGES) {
        const pkgJsonPath = path.join(repoRoot, 'packages', pkg, 'package.json');
        if (!fs.existsSync(pkgJsonPath)) {
            throw new Error(`Package file not found: ${pkgJsonPath}`);
        }

        const raw = fs.readFileSync(pkgJsonPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const oldVersion = parsed.version;
        parsed.version = bareVersion;
        fs.writeFileSync(pkgJsonPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
        bumped.push(`@0ctx/${pkg} ${oldVersion} → ${bareVersion}`);
    }

    return { bumped, version: bareVersion };
}

function getNpmCommand(): string {
    return 'npm';
}

function resolveRepoRoot(): string {
    try {
        return execSync('git rev-parse --show-toplevel', {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe']
        }).toString().trim();
    } catch {
        throw new Error('Not inside the 0ctx repository (git root required for release command).');
    }
}

async function runProcess(
    command: string,
    args: string[],
    cwd: string,
    mode: RunMode,
    useShell = false
): Promise<ProcessRunResult> {
    const startedAt = Date.now();
    return await new Promise(resolve => {
        const child = spawn(command, args, {
            cwd,
            env: process.env,
            stdio: mode === 'inherit' ? 'inherit' : 'pipe',
            windowsHide: true,
            shell: useShell
        });

        let stdout = '';
        let stderr = '';

        if (mode === 'capture') {
            child.stdout?.on('data', chunk => {
                stdout += chunk.toString();
            });
            child.stderr?.on('data', chunk => {
                stderr += chunk.toString();
            });
        }

        child.on('error', error => {
            const finishedAt = Date.now();
            resolve({
                ok: false,
                command,
                args,
                exitCode: 1,
                stdout,
                stderr: `${stderr}\n${error instanceof Error ? error.message : String(error)}`.trim(),
                durationMs: finishedAt - startedAt
            });
        });

        child.on('close', code => {
            const finishedAt = Date.now();
            resolve({
                ok: code === 0,
                command,
                args,
                exitCode: code,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                durationMs: finishedAt - startedAt
            });
        });
    });
}

function buildNpmRunArgs(script: string, scriptArgs: string[] = []): string[] {
    const args = ['run', script];
    if (scriptArgs.length > 0) {
        args.push('--', ...scriptArgs);
    }
    return args;
}

async function runNpmScript(
    stepId: string,
    script: string,
    scriptArgs: string[],
    repoRoot: string,
    mode: RunMode
): Promise<ReleaseStepResult> {
    const command = getNpmCommand();
    const args = buildNpmRunArgs(script, scriptArgs);
    const result = await runProcess(command, args, repoRoot, mode, process.platform === 'win32');
    return {
        ...result,
        id: stepId
    };
}

async function runPublishScript(
    stepId: string,
    params: {
        repoRoot: string;
        dryRun: boolean;
        allowDirty?: boolean;
        otp?: string;
        tag: string;
    },
    mode: RunMode
): Promise<ReleaseStepResult> {
    const scriptPath = path.join(params.repoRoot, 'scripts', 'release', 'publish-packages.ps1');
    const args = ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Tag', params.tag];
    if (params.dryRun) {
        args.push('-DryRun');
    }
    if (params.allowDirty) {
        args.push('-AllowDirty');
    }
    if (params.otp) {
        args.push('-OTP', params.otp);
    }

    const result = await runProcess('powershell', args, params.repoRoot, mode);
    return {
        ...result,
        id: stepId
    };
}

export async function runReleasePublish(options: ReleasePublishOptions): Promise<ReleasePublishResult> {
    const repoRoot = resolveRepoRoot();
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
