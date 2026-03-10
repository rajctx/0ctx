import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync } from 'fs';
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
});
