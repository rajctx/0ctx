import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHookStatusCommand } from '../src/commands/connector/hook/status';

describe('connector hook status', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    afterEach(() => {
        logSpy.mockClear();
    });

    it('hides preview integrations by default', async () => {
        const command = createHookStatusCommand({
            readHookInstallState: () => ({
                projectRoot: 'C:\\repo',
                projectConfigPath: 'C:\\repo\\.0ctx\\settings.local.json',
                updatedAt: Date.UTC(2026, 2, 9),
                agents: [
                    { agent: 'claude', status: 'installed', installed: true },
                    { agent: 'factory', status: 'installed', installed: true },
                    { agent: 'codex', status: 'preview-installed', installed: true }
                ]
            })
        } as any);

        const exitCode = await command({});
        const output = logSpy.mock.calls.flat().join('\n');

        expect(exitCode).toBe(0);
        expect(output).toContain('claude: installed (installed)');
        expect(output).toContain('factory: installed (installed)');
        expect(output).toContain('preview: hidden');
        expect(output).not.toContain('codex: preview-installed');
    });

    it('shows preview integrations when explicitly requested', async () => {
        const command = createHookStatusCommand({
            readHookInstallState: () => ({
                projectRoot: 'C:\\repo',
                projectConfigPath: 'C:\\repo\\.0ctx\\settings.local.json',
                updatedAt: Date.UTC(2026, 2, 9),
                agents: [
                    { agent: 'claude', status: 'installed', installed: true },
                    { agent: 'codex', status: 'preview-installed', installed: true }
                ]
            })
        } as any);

        const exitCode = await command({ 'include-preview': true });
        const output = logSpy.mock.calls.flat().join('\n');

        expect(exitCode).toBe(0);
        expect(output).toContain('claude: installed (installed)');
        expect(output).toContain('codex: preview-installed (installed)');
        expect(output).not.toContain('preview: hidden');
    });
});
