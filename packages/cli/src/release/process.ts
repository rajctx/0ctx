import { execSync, spawn } from 'child_process';
import path from 'path';

export type RunMode = 'inherit' | 'capture';

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

export function getNpmCommand(): string {
    return 'npm';
}

export function resolveReleaseRepoRoot(): string {
    try {
        return execSync('git rev-parse --show-toplevel', {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe']
        })
            .toString()
            .trim();
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
            resolve({
                ok: false,
                command,
                args,
                exitCode: 1,
                stdout,
                stderr: `${stderr}\n${error instanceof Error ? error.message : String(error)}`.trim(),
                durationMs: Date.now() - startedAt
            });
        });

        child.on('close', code => {
            resolve({
                ok: code === 0,
                command,
                args,
                exitCode: code,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                durationMs: Date.now() - startedAt
            });
        });
    });
}

export function buildNpmRunArgs(script: string, scriptArgs: string[] = []): string[] {
    return scriptArgs.length > 0 ? ['run', script, '--', ...scriptArgs] : ['run', script];
}

export async function runNpmScript(
    stepId: string,
    script: string,
    scriptArgs: string[],
    repoRoot: string,
    mode: RunMode
): Promise<ReleaseStepResult> {
    const result = await runProcess(getNpmCommand(), buildNpmRunArgs(script, scriptArgs), repoRoot, mode, process.platform === 'win32');
    return { ...result, id: stepId };
}

export async function runPublishScript(
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
    if (params.dryRun) args.push('-DryRun');
    if (params.allowDirty) args.push('-AllowDirty');
    if (params.otp) args.push('-OTP', params.otp);
    const result = await runProcess('powershell', args, params.repoRoot, mode);
    return { ...result, id: stepId };
}
