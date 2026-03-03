import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapMcpRegistration } from '../src/bootstrap';

const tempDirs: string[] = [];

function createTempRoot(prefix: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(root);
    return root;
}

function createEntrypoint(root: string): string {
    const filePath = path.join(root, 'mcp-index.js');
    fs.writeFileSync(filePath, 'console.log("mcp");\n', 'utf8');
    return filePath;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('bootstrapMcpRegistration', () => {
    it('creates Claude config when client directory exists', () => {
        const root = createTempRoot('0ctx-mcp-bootstrap-');
        const homeDir = path.join(root, 'home');
        const appDataDir = path.join(root, 'AppData', 'Roaming');
        const claudeDir = path.join(appDataDir, 'Claude');
        const entrypoint = createEntrypoint(root);
        fs.mkdirSync(claudeDir, { recursive: true });

        const results = bootstrapMcpRegistration({
            clients: ['claude'],
            entrypoint,
            platform: 'win32',
            homeDir,
            appDataDir
        });

        expect(results).toHaveLength(1);
        expect(results[0].status).toBe('created');

        const configPath = path.join(claudeDir, 'claude_desktop_config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { mcpServers: Record<string, unknown> };
        expect(config.mcpServers).toHaveProperty('0ctx');
    });

    it('is idempotent on repeated bootstrap calls', () => {
        const root = createTempRoot('0ctx-mcp-bootstrap-');
        const homeDir = path.join(root, 'home');
        const appDataDir = path.join(root, 'AppData', 'Roaming');
        const claudeDir = path.join(appDataDir, 'Claude');
        const entrypoint = createEntrypoint(root);
        fs.mkdirSync(claudeDir, { recursive: true });

        const first = bootstrapMcpRegistration({
            clients: ['claude'],
            entrypoint,
            platform: 'win32',
            homeDir,
            appDataDir
        });
        const second = bootstrapMcpRegistration({
            clients: ['claude'],
            entrypoint,
            platform: 'win32',
            homeDir,
            appDataDir
        });

        expect(first[0].status === 'created' || first[0].status === 'updated').toBe(true);
        expect(second[0].status).toBe('unchanged');
    });

    it('skips when no known client directory exists', () => {
        const root = createTempRoot('0ctx-mcp-bootstrap-');
        const entrypoint = createEntrypoint(root);

        const results = bootstrapMcpRegistration({
            clients: ['cursor'],
            entrypoint,
            platform: 'win32',
            homeDir: path.join(root, 'home'),
            appDataDir: path.join(root, 'AppData', 'Roaming')
        });

        expect(results[0].status).toBe('skipped');
    });

    it('resolves entrypoint from cwd dist when no explicit entrypoint is provided', () => {
        const root = createTempRoot('0ctx-mcp-bootstrap-');
        const previousCwd = process.cwd();
        const homeDir = path.join(root, 'home');
        const appDataDir = path.join(root, 'AppData', 'Roaming');
        const claudeDir = path.join(appDataDir, 'Claude');
        const distDir = path.join(root, 'dist');
        fs.mkdirSync(claudeDir, { recursive: true });
        fs.mkdirSync(distDir, { recursive: true });
        fs.writeFileSync(path.join(distDir, 'index.js'), 'console.log("mcp");\n', 'utf8');

        try {
            process.chdir(root);
            const results = bootstrapMcpRegistration({
                clients: ['claude'],
                platform: 'win32',
                homeDir,
                appDataDir
            });

            expect(results).toHaveLength(1);
            expect(results[0].status).toBe('created');
        } finally {
            process.chdir(previousCwd);
        }
    });
});
