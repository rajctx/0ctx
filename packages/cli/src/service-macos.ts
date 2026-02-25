import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, execSync } from 'child_process';

const SERVICE_LABEL = 'com.0ctx.daemon';
const PLIST_TEMPLATE_PATH = path.resolve(
    __dirname, '../../../scripts/service/macos/com.0ctx.daemon.plist'
);
const LAUNCH_AGENTS_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const INSTALLED_PLIST = path.join(LAUNCH_AGENTS_DIR, `${SERVICE_LABEL}.plist`);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveNodePath(): string {
    return process.execPath;
}

function resolveCliEntry(): string {
    const candidates = [
        (() => { try { return require.resolve('@0ctx/cli/dist/index.js'); } catch { return ''; } })(),
        path.resolve(__dirname, 'index.js'),
        path.resolve(__dirname, '..', '..', 'cli', 'dist', 'index.js'),
        path.resolve(process.cwd(), 'packages', 'cli', 'dist', 'index.js'),
    ].filter(Boolean);

    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    throw new Error(
        'Cannot resolve CLI entry point. Run `npm run build` or install @0ctx/cli.'
    );
}

function ensureLogDir(): string {
    const logDir = path.join(os.homedir(), '.0ctx', 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    return logDir;
}

function launchctl(...args: string[]): void {
    execFileSync('launchctl', args, { stdio: 'inherit' });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function installService(): void {
    if (!fs.existsSync(LAUNCH_AGENTS_DIR)) {
        fs.mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
    }

    const nodePath = resolveNodePath();
    const cliEntry = resolveCliEntry();
    const logDir = ensureLogDir();

    let plist = fs.readFileSync(PLIST_TEMPLATE_PATH, 'utf8');
    plist = plist.replace(/%NODE_PATH%/g, nodePath);
    plist = plist.replace(/%CLI_ENTRY%/g, cliEntry);
    plist = plist.replace(/%LOG_DIR%/g, logDir);

    fs.writeFileSync(INSTALLED_PLIST, plist, 'utf8');
    launchctl('load', '-w', INSTALLED_PLIST);

    console.log(`Service '${SERVICE_LABEL}' installed and loaded.`);
    console.log(`Node:   ${nodePath}`);
    console.log(`Entry:  ${cliEntry}`);
    console.log(`Plist:  ${INSTALLED_PLIST}`);
    console.log(`Logs:   ${logDir}`);
}

export function enableService(): void {
    // Load with -w writes the Disabled=false key → survives reboot
    launchctl('load', '-w', INSTALLED_PLIST);
    console.log(`Service '${SERVICE_LABEL}' enabled (auto-start on login).`);
}

export function disableService(): void {
    // Unload with -w writes Disabled=true → survives reboot without removing plist
    launchctl('unload', '-w', INSTALLED_PLIST);
    console.log(`Service '${SERVICE_LABEL}' disabled (will not auto-start).`);
}

export function uninstallService(): void {
    if (fs.existsSync(INSTALLED_PLIST)) {
        try { launchctl('unload', INSTALLED_PLIST); } catch { /* may not be loaded */ }
        fs.unlinkSync(INSTALLED_PLIST);
    }
    console.log(`Service '${SERVICE_LABEL}' uninstalled.`);
}

export function statusService(): void {
    console.log(`service: ${SERVICE_LABEL}`);
    console.log(`plist:   ${INSTALLED_PLIST}`);
    console.log(`installed: ${fs.existsSync(INSTALLED_PLIST)}`);
    console.log(`logs:    ${path.join(os.homedir(), '.0ctx', 'logs')}`);
    try {
        execSync(`launchctl print gui/$(id -u)/${SERVICE_LABEL}`, { stdio: 'inherit' });
    } catch {
        console.log('state:   not loaded (run: 0ctx daemon service install)');
    }
}

export function startService(): void {
    launchctl('start', SERVICE_LABEL);
    console.log(`Service '${SERVICE_LABEL}' start command issued.`);
}

export function stopService(): void {
    launchctl('stop', SERVICE_LABEL);
    console.log(`Service '${SERVICE_LABEL}' stop command issued.`);
}

export function restartService(): void {
    try { launchctl('stop', SERVICE_LABEL); } catch { /* may already be stopped */ }
    launchctl('start', SERVICE_LABEL);
    console.log(`Service '${SERVICE_LABEL}' restarted.`);
}
