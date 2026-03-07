import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, execSync } from 'child_process';

const SERVICE_ID = '0ctx-daemon';
const SERVICE_DIR = path.join(os.homedir(), '.0ctx', 'service');
const INSTALLED_XML_PATH = path.join(SERVICE_DIR, `${SERVICE_ID}.xml`);
const INSTALLED_EXE_PATH = path.join(SERVICE_DIR, `${SERVICE_ID}.exe`);
const DEFAULT_SERVICE_XML_TEMPLATE = `<service>
  <!-- Windows Service definition for the 0ctx connector runtime -->
  <!-- This fallback template is used when no local template file is found -->
  <!-- The CLI replaces %NODE_PATH% and %CLI_ENTRY% before writing -->

  <id>0ctx-daemon</id>
  <name>0ctx Connector Runtime</name>
  <description>0ctx connector runtime - cloud bridge and managed local daemon lifecycle</description>

  <executable>%NODE_PATH%</executable>
  <arguments>"%CLI_ENTRY%" connector run --quiet --interval-ms=5000</arguments>

  <startmode>Automatic</startmode>
  <delayedAutoStart>false</delayedAutoStart>

  <!-- Restart on failure: 3 attempts, 5 s delay each -->
  <onfailure action="restart" delay="5 sec"/>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <resetfailure>1 hour</resetfailure>

  <!-- Log output from the connector runtime process -->
  <logpath>%LOG_PATH%</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>5</keepFiles>
  </log>

  <!-- Environment passthrough -->
  <env name="NODE_ENV" value="production"/>
  <env name="USERPROFILE" value="%USER_HOME%"/>
  <env name="HOME" value="%USER_HOME%"/>

</service>
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureServiceDir(): void {
    if (!fs.existsSync(SERVICE_DIR)) {
        fs.mkdirSync(SERVICE_DIR, { recursive: true });
    }
}

function resolveNodePath(): string {
    return process.execPath;
}

function loadServiceXmlTemplate(): string {
    const candidates = [
        // dev/dist in monorepo
        path.resolve(__dirname, '..', '..', '..', 'scripts', 'service', 'windows', '0ctx-daemon.xml'),
        path.resolve(process.cwd(), 'scripts', 'service', 'windows', '0ctx-daemon.xml'),
        // npm package-local fallback if template is bundled next to dist
        path.resolve(__dirname, '..', 'service', 'windows', '0ctx-daemon.xml'),
    ];

    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) {
                return fs.readFileSync(candidate, 'utf8');
            }
        } catch {
            // keep searching
        }
    }

    return DEFAULT_SERVICE_XML_TEMPLATE;
}

function resolveCliEntry(): string {
    const candidates = [
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

function findWinSWBinary(moduleRoot: string): string | null {
    try {
        const binDir = path.join(moduleRoot, 'winsw', 'bin');
        if (!fs.existsSync(binDir)) return null;

        const candidates = fs.readdirSync(binDir)
            .filter(file => /^winsw.*\.exe$/i.test(file))
            .map(file => path.join(binDir, file))
            .filter(file => fs.existsSync(file));

        return candidates[0] ?? null;
    } catch {
        return null;
    }
}

function resolveWinSW(): string {
    const candidates = [
        // npm global install with nvm/node tends to place @0ctx/cli in:
        //   <prefix>/node_modules/@0ctx/cli/dist
        // so ../../.. is the shared node_modules root.
        findWinSWBinary(path.resolve(__dirname, '..', '..', '..')),
        // monorepo/local install fallback
        findWinSWBinary(path.resolve(process.cwd(), 'node_modules')),
        path.resolve(__dirname, '..', '..', '..', 'node_modules', '.bin', 'winsw.exe'),
        (() => {
            try {
                const npmRoot = execSync('npm root -g', { encoding: 'utf8', stdio: 'pipe' }).trim();
                return npmRoot.length > 0 ? findWinSWBinary(npmRoot) : null;
            } catch {
                return null;
            }
        })(),
    ];

    for (const c of candidates.filter((candidate): candidate is string => Boolean(candidate))) {
        try {
            if (fs.existsSync(c)) return c;
        } catch { /* skip */ }
    }

    throw new Error(
        'winsw not found. Run: npm install -g winsw  or  npm install --save-optional winsw'
    );
}

function runWinSW(serviceExePath: string, args: string[]): void {
    execFileSync(serviceExePath, args, { stdio: 'inherit' });
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

function sleepSync(ms: number): void {
    // Cross-shell pause without invoking platform-specific timeout binaries.
    const lock = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(lock, 0, 0, ms);
}

// ─── Public API (called from CLI index.ts) ────────────────────────────────────

export function installService(): void {
    requireAdmin();
    ensureServiceDir();

    const nodePath = resolveNodePath();
    const cliEntry = resolveCliEntry();
    const winswPath = resolveWinSW();
    const userHome = os.homedir();
    const logDir = path.join(userHome, '.0ctx', 'logs');
    const escapedNodePath = nodePath.replace(/\\/g, '\\\\');
    const escapedCliEntry = cliEntry.replace(/\\/g, '\\\\');
    const escapedLogDir = logDir.replace(/\\/g, '\\\\');
    const escapedUserHome = userHome.replace(/\\/g, '\\\\');

    // Ensure log dir exists before service install/start.
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    // Copy winsw exe
    fs.copyFileSync(winswPath, INSTALLED_EXE_PATH);

    // Write substituted XML
    let xml = loadServiceXmlTemplate();
    xml = xml.replace(/%NODE_PATH%/g, escapedNodePath);
    xml = xml.replace(/%CLI_ENTRY%/g, escapedCliEntry);
    xml = xml.replace(/%LOG_PATH%/g, escapedLogDir);
    xml = xml.replace(/%USER_HOME%/g, escapedUserHome);
    // Backward compatibility for older templates before %LOG_PATH% existed.
    xml = xml.split('%USERPROFILE%\\.0ctx\\logs').join(escapedLogDir);
    fs.writeFileSync(INSTALLED_XML_PATH, xml, 'utf8');

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
    sleepSync(2000);
    execSync(`sc start "${SERVICE_ID}"`, { stdio: 'inherit' });
    console.log(`Service '${SERVICE_ID}' restarted.`);
}
