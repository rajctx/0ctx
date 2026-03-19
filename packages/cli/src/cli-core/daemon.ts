import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync, spawn, spawnSync } from 'child_process';
import { sendToDaemon } from '@0ctx/mcp/dist/client';

export interface DaemonHealthSummary {
    ok: boolean;
    error?: string;
    health?: any;
}

export interface DaemonCapabilityCheck {
    ok: boolean;
    reachable: boolean;
    apiVersion: string | null;
    methods: string[];
    missingMethods: string[];
    error: string | null;
    recoverySteps: string[];
}

export async function isDaemonReachable(): Promise<DaemonHealthSummary> {
    try {
        const health = await sendToDaemon('health', {});
        return { ok: true, health };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

export async function checkDaemonCapabilities(requiredMethods: string[]): Promise<DaemonCapabilityCheck> {
    const daemon = await isDaemonReachable();
    if (!daemon.ok) {
        return {
            ok: false,
            reachable: false,
            apiVersion: null,
            methods: [],
            missingMethods: [...requiredMethods],
            error: daemon.error ?? 'daemon_unreachable',
            recoverySteps: inferDaemonRecoverySteps(daemon.error)
        };
    }

    try {
        const capabilities = await sendToDaemon('getCapabilities', {}) as { apiVersion?: string; methods?: string[] } | null;
        const apiVersion = typeof capabilities?.apiVersion === 'string' ? capabilities.apiVersion : null;
        const methods = Array.isArray(capabilities?.methods) ? capabilities.methods : [];
        const missingMethods = requiredMethods.filter(method => !methods.includes(method));
        const versionMismatch = apiVersion !== null && apiVersion !== '2';
        const ok = !versionMismatch && missingMethods.length === 0;
        return {
            ok,
            reachable: true,
            apiVersion,
            methods,
            missingMethods,
            error: versionMismatch ? `api_version_mismatch:${apiVersion}` : null,
            recoverySteps: ['0ctx daemon start', '0ctx daemon service restart']
        };
    } catch (error) {
        return {
            ok: false,
            reachable: true,
            apiVersion: null,
            methods: [],
            missingMethods: [...requiredMethods],
            error: error instanceof Error ? error.message : String(error),
            recoverySteps: ['0ctx daemon start', '0ctx daemon service restart']
        };
    }
}

export function inferDaemonRecoverySteps(error?: string): string[] {
    const normalized = (error ?? '').toLowerCase();
    const steps: string[] = ['0ctx daemon start'];

    if (normalized.includes('enoent') || normalized.includes('econnrefused') || normalized.includes('not running')) {
        steps.push('0ctx daemon service status');
        steps.push('0ctx daemon service start');
    }

    if (normalized.includes('eacces') || normalized.includes('permission') || normalized.includes('access is denied')) {
        steps.push('Run terminal as Administrator, then retry service commands');
    }

    steps.push('0ctx doctor');
    return Array.from(new Set(steps));
}

async function requestDaemonShutdown(): Promise<void> {
    try {
        await sendToDaemon('shutdown', {});
    } catch {
        // Best-effort only.
    }
}

async function waitForDaemonExit(timeoutMs = 5000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const status = await isDaemonReachable();
        if (!status.ok) return true;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    return false;
}

function forceStopDaemonProcesses(): void {
    try {
        if (os.platform() === 'win32') {
            const script = [
                'Get-CimInstance Win32_Process |',
                '  Where-Object {',
                "    if ($_.Name -ne 'node.exe') { return $false }",
                '    if (-not $_.CommandLine) { return $false }',
                '    $cmd = $_.CommandLine.ToLower()',
                "    return $cmd.Contains('daemon.js') -and ($cmd.Contains('@0ctx') -or $cmd.Contains('packages\\\\cli\\\\dist\\\\daemon.js') -or $cmd.Contains('packages\\\\daemon\\\\dist\\\\index.js'))",
                '  } |',
                '  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'
            ].join('\n');
            spawnSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore', windowsHide: true });
            return;
        }

        const output = execSync('ps -ax -o pid= -o command=', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const pids = output
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                const match = line.match(/^(\d+)\s+(.*)$/);
                if (!match) return null;
                const pid = Number.parseInt(match[1], 10);
                const command = match[2].toLowerCase();
                const matches = command.includes('daemon.js')
                    && (command.includes('@0ctx')
                        || command.includes('packages/cli/dist/daemon.js')
                        || command.includes('packages/daemon/dist/index.js'));
                return Number.isFinite(pid) && matches ? pid : null;
            })
            .filter((value): value is number => typeof value === 'number');
        for (const pid of pids) {
            try {
                process.kill(pid, 'SIGKILL');
            } catch {
                // Best-effort.
            }
        }
    } catch {
        // Best-effort only.
    }
}

function resolveDaemonEntrypoint(): string {
    const candidates = [
        path.resolve(__dirname, 'daemon.js'),
        path.resolve(process.cwd(), 'packages', 'daemon', 'dist', 'index.js'),
        path.resolve(__dirname, '..', '..', 'daemon', 'dist', 'index.js'),
        (() => {
            try {
                return require.resolve('@0ctx/daemon/dist/index.js');
            } catch {
                return '';
            }
        })()
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    throw new Error(
        'Could not resolve daemon entrypoint. Run `npm run build` (repo) or reinstall/repair the CLI package.'
    );
}

export function startDaemonDetached(): void {
    const entry = resolveDaemonEntrypoint();
    const child = spawn(process.execPath, [entry], {
        detached: true,
        stdio: 'ignore'
    });
    child.unref();
}

export async function waitForDaemon(timeoutMs = 10000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const status = await isDaemonReachable();
        if (status.ok) return true;
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    return false;
}

async function restartDaemonForCapabilityRefresh(): Promise<boolean> {
    await requestDaemonShutdown();
    const stopped = await waitForDaemonExit();
    if (!stopped) {
        forceStopDaemonProcesses();
        await waitForDaemonExit();
    }
    startDaemonDetached();
    return waitForDaemon();
}

export async function ensureDaemonCapabilities(requiredMethods: string[]): Promise<DaemonCapabilityCheck> {
    let check = await checkDaemonCapabilities(requiredMethods);
    if (check.ok || !check.reachable) {
        return check;
    }

    const shouldRestart = check.missingMethods.length > 0
        || (typeof check.apiVersion === 'string' && check.apiVersion !== '2')
        || (typeof check.error === 'string' && check.error.toLowerCase().includes('unknown method'));
    if (!shouldRestart) {
        return check;
    }

    try {
        const restarted = await restartDaemonForCapabilityRefresh();
        if (!restarted) {
            return check;
        }
        check = await checkDaemonCapabilities(requiredMethods);
        return check;
    } catch {
        return check;
    }
}

export function printCapabilityMismatch(commandLabel: string, check: DaemonCapabilityCheck): void {
    console.error(`${commandLabel}_unavailable: daemon capability check failed.`);
    if (check.error) {
        console.error(`reason: ${check.error}`);
    }
    if (check.apiVersion && check.apiVersion !== '2') {
        console.error(`api_version: ${check.apiVersion} (expected 2)`);
    }
    if (check.missingMethods.length > 0) {
        console.error(`missing_methods: ${check.missingMethods.join(', ')}`);
    }
    console.error('Restart daemon/service after updating binaries:');
    for (const step of check.recoverySteps) {
        console.error(`  ${step}`);
    }
}
