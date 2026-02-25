import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, execSync } from 'child_process';

const SERVICE_ID = '0ctx-daemon';
const SERVICE_DIR = path.join(os.homedir(), '.0ctx', 'service');
const XML_TEMPLATE_PATH = path.resolve(__dirname, '../../../scripts/service/windows/0ctx-daemon.xml');
const INSTALLED_XML_PATH = path.join(SERVICE_DIR, `${SERVICE_ID}.xml`);
const INSTALLED_EXE_PATH = path.join(SERVICE_DIR, `${SERVICE_ID}.exe`);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureServiceDir(): void {
    if (!fs.existsSync(SERVICE_DIR)) {
        fs.mkdirSync(SERVICE_DIR, { recursive: true });
    }
}

function resolveNodePath(): string {
    return process.execPath;
}

function resolveCliEntry(): string {
    const candidates = [
        // published install path: cli package owns connector runtime entry
        (() => {
            try { return require.resolve('@0ctx/cli/dist/index.js'); } catch { return ''; }
        })(),
        // local dist sibling in this package
        path.resolve(__dirname, 'index.js'),
        // monorepo fallback
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

function resolveWinSW(): string {
    // winsw npm package places the exe at node_modules/.bin/winsw.exe or winsw
    const candidates = [
        path.resolve(__dirname, '..', '..', '..', 'node_modules', '.bin', 'winsw.exe'),
        path.resolve(__dirname, '..', '..', '..', 'node_modules', '.bin', 'winsw'),
        // global npm bin
        'winsw',
    ];
    for (const c of candidates) {
        try {
            if (c !== 'winsw' && fs.existsSync(c)) return c;
        } catch { /* skip */ }
    }
    // try PATH
    try {
        execFileSync('winsw', ['version'], { stdio: 'pipe' });
        return 'winsw';
    } catch { /* not in PATH */ }

    throw new Error(
        'winsw not found. Run: npm install -g winsw  or  npm install --save-optional winsw'
    );
}

function runWinSW(winswPath: string, args: string[]): void {
    execFileSync(winswPath, [INSTALLED_EXE_PATH, ...args], { stdio: 'inherit' });
}

function scQuery(): string {
    try {
        return execSync(`sc query "${SERVICE_ID}"`, { encoding: 'utf8' });
    } catch (e: unknown) {
        const err = e as { stdout?: string };
        return err?.stdout ?? String(e);
    }
}

function parseScState(output: string): string {
    const match = output.match(/STATE\s*:\s*\d+\s+(\w+)/);
    return match ? match[1] : 'UNKNOWN';
}

function requireAdmin(): void {
    try {
        execSync('net session', { stdio: 'pipe' });
    } catch {
        throw new Error(
            'This command requires Administrator privileges. ' +
            'Re-run in an elevated terminal (Run as Administrator).'
        );
    }
}

// ─── Public API (called from CLI index.ts) ────────────────────────────────────

export function installService(): void {
    requireAdmin();
    ensureServiceDir();

    const nodePath = resolveNodePath();
    const cliEntry = resolveCliEntry();
    const winswPath = resolveWinSW();

    // Copy winsw exe
    fs.copyFileSync(winswPath.endsWith('.exe') ? winswPath : winswPath, INSTALLED_EXE_PATH);

    // Write substituted XML
    let xml = fs.readFileSync(XML_TEMPLATE_PATH, 'utf8');
    xml = xml.replace(/%NODE_PATH%/g, nodePath.replace(/\\/g, '\\\\'));
    xml = xml.replace(/%CLI_ENTRY%/g, cliEntry.replace(/\\/g, '\\\\'));
    fs.writeFileSync(INSTALLED_XML_PATH, xml, 'utf8');

    // Ensure log dir exists
    const logDir = path.join(os.homedir(), '.0ctx', 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    runWinSW(INSTALLED_EXE_PATH, ['install']);
    console.log(`Service '${SERVICE_ID}' installed.`);
    console.log(`Node: ${nodePath}`);
    console.log(`CLI entry: ${cliEntry}`);
    console.log(`Service dir: ${SERVICE_DIR}`);
    console.log('Run: 0ctx daemon service enable  →  to set auto-start');
    console.log('Run: 0ctx daemon service start   →  to start immediately');
}

export function enableService(): void {
    requireAdmin();
    execSync(`sc config "${SERVICE_ID}" start= auto`, { stdio: 'inherit' });
    console.log(`Service '${SERVICE_ID}' start type set to Automatic.`);
}

export function disableService(): void {
    requireAdmin();
    execSync(`sc config "${SERVICE_ID}" start= demand`, { stdio: 'inherit' });
    console.log(`Service '${SERVICE_ID}' start type set to Manual.`);
}

export function uninstallService(): void {
    requireAdmin();
    if (!fs.existsSync(INSTALLED_EXE_PATH)) {
        throw new Error(`Service exe not found at ${INSTALLED_EXE_PATH}. Was it installed?`);
    }
    runWinSW(INSTALLED_EXE_PATH, ['uninstall']);
    console.log(`Service '${SERVICE_ID}' uninstalled.`);
}

export function statusService(): void {
    const output = scQuery();
    const state = parseScState(output);
    console.log(`service: ${SERVICE_ID}`);
    console.log(`state:   ${state}`);
    console.log(`dir:     ${SERVICE_DIR}`);
    console.log(`xml:     ${INSTALLED_XML_PATH}`);
    console.log(`log:     ${path.join(os.homedir(), '.0ctx', 'logs')}`);
}

export function startService(): void {
    requireAdmin();
    execSync(`sc start "${SERVICE_ID}"`, { stdio: 'inherit' });
    console.log(`Service '${SERVICE_ID}' start command issued.`);
}

export function stopService(): void {
    requireAdmin();
    execSync(`sc stop "${SERVICE_ID}"`, { stdio: 'inherit' });
    console.log(`Service '${SERVICE_ID}' stop command issued.`);
}

export function restartService(): void {
    requireAdmin();
    try {
        execSync(`sc stop "${SERVICE_ID}"`, { stdio: 'pipe' });
    } catch { /* may already be stopped */ }
    // Brief pause to allow the service to stop
    execSync('timeout /t 2 /nobreak', { stdio: 'pipe' });
    execSync(`sc start "${SERVICE_ID}"`, { stdio: 'inherit' });
    console.log(`Service '${SERVICE_ID}' restarted.`);
}
