import { afterEach, describe, expect, it, vi } from 'vitest';
import { printHelp } from '../src/commands/help';

describe('printHelp', () => {
    const originalLog = console.log;

    afterEach(() => {
        console.log = originalLog;
        vi.restoreAllMocks();
    });

    it('keeps MCP mechanics out of the default help surface', () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        printHelp(false);

        const output = String(consoleSpy.mock.calls[0]?.[0] ?? '');
        expect(output).toContain('0ctx enable [--repo-root=<path>] [--name=<workspace>] [--data-policy=<lean|review|debug>] [--json]');
        expect(output).toContain('[--clients=ga|claude,factory,antigravity]');
        expect(output).not.toContain('--mcp-clients');
        expect(output).not.toContain('--mcp-profile');
    });

    it('keeps explicit MCP controls in the advanced help surface', () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        printHelp(true);

        const output = String(consoleSpy.mock.calls[0]?.[0] ?? '');
        expect(output).toContain('--mcp-clients=none|ga|claude,antigravity');
        expect(output).toContain('--mcp-profile=all|core|recall|ops');
        expect(output).toContain('Interactive supported-agent retrieval bootstrap');
    });
});
