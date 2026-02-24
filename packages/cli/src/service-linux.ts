import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

const SERVICE_NAME = '0ctx-daemon';
const UNIT_TEMPLATE_PATH = path.resolve(
    __dirname, '../../../scripts/service/linux/0ctx-daemon.service'
);
const SYSTEMD_USER_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const INSTALLED_UNIT = path.join(SYSTEMD_USER_DIR, `${SERVICE_NAME}.service`);

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

function systemctl(...args: string[]): void {
    execSync(`systemctl --user ${args.join(' ')}`, { stdio: 'inherit' });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function installService(): void {
    if (!fs.existsSync(SYSTEMD_USER_DIR)) {
        fs.mkdirSync(SYSTEMD_USER_DIR, { recursive: true });
    }

    const nodePath = resolveNodePath();
    const cliEntry = resolveCliEntry();

    let unit = fs.readFileSync(UNIT_TEMPLATE_PATH, 'utf8');
    unit = unit.replace(/%NODE_PATH%/g, nodePath);
    unit = unit.replace(/%CLI_ENTRY%/g, cliEntry);

    fs.writeFileSync(INSTALLED_UNIT, unit, 'utf8');
    systemctl('daemon-reload');

    console.log(`Unit '${SERVICE_NAME}.service' installed.`);
    console.log(`Node:  ${nodePath}`);
    console.log(`Entry: ${cliEntry}`);
    console.log(`Unit:  ${INSTALLED_UNIT}`);
    console.log('Run: 0ctx daemon service enable  →  to set auto-start');
    console.log('Run: 0ctx daemon service start   →  to start immediately');
}

export function enableService(): void {
    systemctl('enable', SERVICE_NAME);
    console.log(`Service '${SERVICE_NAME}' enabled (auto-start on login).`);
    console.log('Tip: run `loginctl enable-linger $USER` for start-at-boot without login.');
}

export function disableService(): void {
    systemctl('disable', SERVICE_NAME);
    console.log(`Service '${SERVICE_NAME}' disabled (will not auto-start).`);
}

export function uninstallService(): void {
    try { systemctl('stop', SERVICE_NAME); } catch { /* may not be running */ }
    try { systemctl('disable', SERVICE_NAME); } catch { /* may not be enabled */ }
    if (fs.existsSync(INSTALLED_UNIT)) {
        fs.unlinkSync(INSTALLED_UNIT);
    }
    try { systemctl('daemon-reload'); } catch { /* best effort */ }
    console.log(`Unit '${SERVICE_NAME}.service' uninstalled.`);
}

export function statusService(): void {
    console.log(`service: ${SERVICE_NAME}`);
    console.log(`unit:    ${INSTALLED_UNIT}`);
    console.log(`installed: ${fs.existsSync(INSTALLED_UNIT)}`);
    try {
        systemctl('status', SERVICE_NAME);
    } catch {
        console.log('state:   not active (run: 0ctx daemon service install && 0ctx daemon service start)');
    }
}

export function startService(): void {
    systemctl('start', SERVICE_NAME);
    console.log(`Service '${SERVICE_NAME}' started.`);
}

export function stopService(): void {
    systemctl('stop', SERVICE_NAME);
    console.log(`Service '${SERVICE_NAME}' stopped.`);
}

export function restartService(): void {
    systemctl('restart', SERVICE_NAME);
    console.log(`Service '${SERVICE_NAME}' restarted.`);
}
