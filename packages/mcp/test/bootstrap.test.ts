import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapMcpRegistration, parseBootstrapClients, validateBootstrapClientSelection } from '../src/bootstrap';

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

    it('writes profile args into MCP registration when mcp profile is provided', () => {
        const root = createTempRoot('0ctx-mcp-bootstrap-');
        const homeDir = path.join(root, 'home');
        const appDataDir = path.join(root, 'AppData', 'Roaming');
        const claudeDir = path.join(appDataDir, 'Claude');
        const entrypoint = createEntrypoint(root);
        fs.mkdirSync(claudeDir, { recursive: true });

        const results = bootstrapMcpRegistration({
            clients: ['claude'],
            entrypoint,
            profile: 'ops',
            platform: 'win32',
            homeDir,
            appDataDir
        });

        expect(results).toHaveLength(1);
        expect(results[0].status).toBe('created');

        const configPath = path.join(claudeDir, 'claude_desktop_config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
            mcpServers: Record<string, { command: string; args: string[] }>;
        };
        const server = config.mcpServers['0ctx'];
        expect(server.args).toEqual([entrypoint, '--profile', 'ops']);
    });

    it('creates Antigravity config using VS Code style User mcp.json location', () => {
        const root = createTempRoot('0ctx-mcp-bootstrap-');
        const homeDir = path.join(root, 'home');
        const appDataDir = path.join(root, 'AppData', 'Roaming');
        const antigravityUserDir = path.join(appDataDir, 'Antigravity', 'User');
        const entrypoint = createEntrypoint(root);
        fs.mkdirSync(antigravityUserDir, { recursive: true });

        const results = bootstrapMcpRegistration({
            clients: ['antigravity'],
            entrypoint,
            platform: 'win32',
            homeDir,
            appDataDir
        });

        expect(results).toHaveLength(1);
        expect(results[0].status).toBe('created');

        const configPath = path.join(antigravityUserDir, 'mcp.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
            mcpServers: Record<string, { command: string; args: string[] }>;
        };
        expect(config.mcpServers['0ctx']).toBeTruthy();
        expect(config.mcpServers['0ctx'].args).toEqual([entrypoint, '--profile', 'core']);
    });

    it('creates Antigravity config in ~/.gemini when that is the detected install shape', () => {
        const root = createTempRoot('0ctx-mcp-bootstrap-');
        const homeDir = path.join(root, 'home');
        const appDataDir = path.join(root, 'AppData', 'Roaming');
        const geminiDir = path.join(homeDir, '.gemini');
        const entrypoint = createEntrypoint(root);
        fs.mkdirSync(geminiDir, { recursive: true });

        const results = bootstrapMcpRegistration({
            clients: ['antigravity'],
            entrypoint,
            platform: 'win32',
            homeDir,
            appDataDir
        });

        expect(results).toHaveLength(1);
        expect(results[0].status).toBe('created');

        const configPath = path.join(geminiDir, 'mcp.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
            mcpServers: Record<string, { command: string; args: string[] }>;
        };
        expect(results[0].configPath).toBe(configPath);
        expect(config.mcpServers['0ctx']).toBeTruthy();
        expect(config.mcpServers['0ctx'].args).toEqual([entrypoint, '--profile', 'core']);
    });

    it('writes Codex MCP server block into ~/.codex/config.toml and stays idempotent', () => {
        const root = createTempRoot('0ctx-mcp-bootstrap-');
        const homeDir = path.join(root, 'home');
        const codexDir = path.join(homeDir, '.codex');
        const entrypoint = createEntrypoint(root);
        fs.mkdirSync(codexDir, { recursive: true });
        fs.writeFileSync(path.join(codexDir, 'config.toml'), 'model = "gpt-5"\n', 'utf8');

        const first = bootstrapMcpRegistration({
            clients: ['codex'],
            entrypoint,
            profile: 'ops',
            platform: 'win32',
            homeDir,
            appDataDir: path.join(root, 'AppData', 'Roaming')
        });
        const second = bootstrapMcpRegistration({
            clients: ['codex'],
            entrypoint,
            profile: 'ops',
            platform: 'win32',
            homeDir,
            appDataDir: path.join(root, 'AppData', 'Roaming')
        });

        expect(first).toHaveLength(1);
        expect(first[0].status).toBe('updated');
        expect(second[0].status).toBe('unchanged');

        const configToml = fs.readFileSync(path.join(codexDir, 'config.toml'), 'utf8');
        expect(configToml).toContain('model = "gpt-5"');
        expect(configToml).toContain('[mcp_servers.0ctx]');
        expect(configToml).toContain(`command = ${JSON.stringify(process.execPath)}`);
        expect(configToml).toContain(`args = [${JSON.stringify(entrypoint)}, "--profile", "ops"]`);
    });

    it('defaults bootstrap client parsing to GA clients only', () => {
        expect(parseBootstrapClients(undefined)).toEqual(['claude', 'antigravity']);
        expect(parseBootstrapClients('ga')).toEqual(['claude', 'antigravity']);
        expect(parseBootstrapClients('preview')).toEqual([]);
        expect(parseBootstrapClients('all')).toEqual([]);
        expect(parseBootstrapClients('cursor')).toEqual(['cursor']);
        expect(parseBootstrapClients('')).toEqual(['claude', 'antigravity']);
    });

    it('rejects preview and all bootstrap shorthands in the normal product path', () => {
        expect(validateBootstrapClientSelection('preview')).toContain('--clients=ga');
        expect(validateBootstrapClientSelection('all')).toContain('--clients=codex,cursor,windsurf');
        expect(validateBootstrapClientSelection('cursor')).toContain('--allow-preview');
        expect(validateBootstrapClientSelection('cursor', true)).toBeNull();
        expect(validateBootstrapClientSelection(undefined)).toBeNull();
    });
});
