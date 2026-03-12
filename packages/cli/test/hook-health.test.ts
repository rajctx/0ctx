import os from 'os';
import path from 'path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createHookHealthCollector } from '../src/cli-core/readiness';

const tempDirs: string[] = [];

function createTempDir(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), '0ctx-hook-health-test-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function createCollector(debugArtifactsEnabled: boolean) {
    const dumpDir = createTempDir();
    return createHookHealthCollector({
        getHookDumpDir: () => dumpDir,
        getHookDumpRetentionDays: () => 14,
        getHookDebugRetentionDays: () => 7,
        isHookDebugArtifactsEnabled: () => debugArtifactsEnabled,
        getHookStatePath: () => path.join(dumpDir, 'hooks-state.json'),
        getHookConfigPath: (projectRoot, agent) => path.join(projectRoot, `.${agent}`, 'config.json'),
        readHookInstallState: () => ({
            projectRoot: dumpDir,
            projectConfigPath: path.join(dumpDir, '.0ctx', 'settings.local.json'),
            contextId: null,
            agents: []
        }),
        sendToDaemon: async () => []
    });
}

describe('hook health dump messaging', () => {
    it('describes support dumps as off by default when debug artifacts are disabled', async () => {
        const collectHookHealth = createCollector(false);
        const result = await collectHookHealth();
        expect(result.dumpCheck.status).toBe('pass');
        expect(result.dumpCheck.message).toContain('raw dumps and debug trails are off by default');
        expect(result.dumpCheck.message).toContain('7 days');
    });

    it('describes support dumps as enabled when debug artifacts are on', async () => {
        const collectHookHealth = createCollector(true);
        const result = await collectHookHealth();
        expect(result.dumpCheck.status).toBe('pass');
        expect(result.dumpCheck.message).toContain('debug artifacts enabled');
        expect(result.dumpCheck.message).toContain('raw dumps kept 14 days');
    });

    it('treats preview integrations as separate from GA hook health', async () => {
        const dumpDir = createTempDir();
        const projectConfigPath = path.join(dumpDir, '.0ctx', 'settings.local.json');
        const claudeConfigPath = path.join(dumpDir, '.claude', 'config.json');
        const codexConfigPath = path.join(dumpDir, '.codex', 'config.json');
        mkdirSync(path.dirname(projectConfigPath), { recursive: true });
        mkdirSync(path.dirname(claudeConfigPath), { recursive: true });
        mkdirSync(path.dirname(codexConfigPath), { recursive: true });
        writeFileSync(projectConfigPath, JSON.stringify({
            projectRoot: dumpDir,
            contextId: null,
            hooks: [
                { agent: 'claude', command: '0ctx connector hook ingest --agent=claude' },
                { agent: 'codex', command: '0ctx connector hook ingest --agent=codex' }
            ]
        }));
        writeFileSync(claudeConfigPath, '0ctx connector hook ingest --agent=claude');
        writeFileSync(codexConfigPath, '# BEGIN 0ctx-codex-notify\n0ctx connector hook ingest --agent=codex\n# END 0ctx-codex-notify');

        const collectHookHealth = createHookHealthCollector({
            getHookDumpDir: () => dumpDir,
            getHookDumpRetentionDays: () => 14,
            getHookDebugRetentionDays: () => 7,
            isHookDebugArtifactsEnabled: () => false,
            getHookStatePath: () => path.join(dumpDir, 'hooks-state.json'),
            getHookConfigPath: (projectRoot, agent) => path.join(projectRoot, `.${agent}`, 'config.json'),
            readHookInstallState: () => ({
                projectRoot: dumpDir,
                projectConfigPath,
                contextId: null,
                agents: [
                    { agent: 'claude', installed: true, command: '0ctx connector hook ingest --agent=claude' },
                    { agent: 'codex', installed: true, command: '0ctx connector hook ingest --agent=codex' }
                ]
            }),
            sendToDaemon: async () => []
        });

        const result = await collectHookHealth();
        expect(result.check.status).toBe('pass');
        expect(result.details.installedAgentCount).toBe(1);
        expect(result.details.agents.map((agent) => agent.agent)).toEqual(['claude']);
        expect(result.details.previewInstalledAgentCount).toBe(1);
        expect(result.details.previewAgents?.map((agent) => agent.agent)).toEqual(['codex']);
    });
});
