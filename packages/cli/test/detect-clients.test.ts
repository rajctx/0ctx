import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectInstalledGaHookClients, detectInstalledGaMcpClients, detectRegisteredGaMcpClients } from '../src/cli-core/detect-clients';

const tempDirs: string[] = [];

function tempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '0ctx-detect-clients-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('machine-aware GA client detection', () => {
    it('detects supported capture integrations from machine state', () => {
        const homeDir = tempDir();
        const appDataDir = path.join(homeDir, 'AppData', 'Roaming');
        fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
        fs.mkdirSync(path.join(homeDir, '.factory'), { recursive: true });
        fs.mkdirSync(path.join(homeDir, '.gemini'), { recursive: true });

        expect(detectInstalledGaHookClients({ platform: 'win32', homeDir, appDataDir })).toEqual([
            'claude',
            'factory',
            'antigravity'
        ]);
    });

    it('detects only GA MCP clients that are actually present', () => {
        const homeDir = tempDir();
        const appDataDir = path.join(homeDir, 'AppData', 'Roaming');
        fs.mkdirSync(path.join(appDataDir, 'Claude'), { recursive: true });

        expect(detectInstalledGaMcpClients({ platform: 'win32', homeDir, appDataDir })).toEqual(['claude']);
    });

    it('detects only GA MCP clients that actually register 0ctx', () => {
        const homeDir = tempDir();
        const appDataDir = path.join(homeDir, 'AppData', 'Roaming');
        const claudeConfig = path.join(appDataDir, 'Claude', 'claude_desktop_config.json');
        const antigravityConfig = path.join(homeDir, '.gemini', 'mcp.json');
        fs.mkdirSync(path.dirname(claudeConfig), { recursive: true });
        fs.mkdirSync(path.dirname(antigravityConfig), { recursive: true });
        fs.writeFileSync(claudeConfig, JSON.stringify({ mcpServers: { '0ctx': { command: 'node', args: ['0ctx'] } } }), 'utf8');
        fs.writeFileSync(antigravityConfig, JSON.stringify({ mcpServers: { other: { command: 'node', args: ['other'] } } }), 'utf8');

        expect(detectRegisteredGaMcpClients({ platform: 'win32', homeDir, appDataDir })).toEqual(['claude']);
    });

    it('returns an empty list when no GA integrations are present', () => {
        const homeDir = tempDir();
        const appDataDir = path.join(homeDir, 'AppData', 'Roaming');

        expect(detectInstalledGaHookClients({ platform: 'win32', homeDir, appDataDir })).toEqual([]);
        expect(detectInstalledGaMcpClients({ platform: 'win32', homeDir, appDataDir })).toEqual([]);
        expect(detectRegisteredGaMcpClients({ platform: 'win32', homeDir, appDataDir })).toEqual([]);
    });
});
