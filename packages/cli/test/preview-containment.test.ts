import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { printHelp } from '../src/commands/help';

describe('preview integration containment', () => {
    const originalLog = console.log;

    afterEach(() => {
        console.log = originalLog;
        vi.restoreAllMocks();
    });

    it('keeps preview integrations out of the default help surface', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});

        printHelp(false);

        const output = String(log.mock.calls[0]?.[0] ?? '');
        expect(output).toContain('Supported integrations:\n  GA: Claude, Factory, Antigravity');
        expect(output).not.toContain('codex');
        expect(output).not.toContain('cursor');
        expect(output).not.toContain('windsurf');
        expect(output).not.toContain('Preview overrides:');
        expect(output).not.toContain('--allow-preview');
    });

    it('keeps preview client names out of the desktop normal-path surfaces', () => {
        const setupSource = readFileSync(
            path.resolve(__dirname, '..', '..', '..', 'desktop-app', 'src', 'renderer', 'screens', 'setup', 'setup-screen.tsx'),
            'utf8'
        );
        const workspacesSource = readFileSync(
            path.resolve(__dirname, '..', '..', '..', 'desktop-app', 'src', 'renderer', 'screens', 'workstreams', 'workstreams-screen.tsx'),
            'utf8'
        );
        const shellSource = readFileSync(
            path.resolve(__dirname, '..', '..', '..', 'desktop-app', 'src', 'renderer', 'routes', 'route-shell.tsx'),
            'utf8'
        );
        const defaultSurfaces = [setupSource, workspacesSource, shellSource].join('\n');

        expect(defaultSurfaces).not.toContain('codex');
        expect(defaultSurfaces).not.toContain('cursor');
        expect(defaultSurfaces).not.toContain('windsurf');
        expect(defaultSurfaces).not.toContain('non-GA');
        expect(defaultSurfaces).not.toContain('--allow-preview');
    });
});
