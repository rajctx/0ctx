import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/cli-core/args';

describe('parseArgs', () => {
    it('does not treat flag values as positional args for repo-first commands', () => {
        const parsed = parseArgs(['data-policy', '--repo-root', '.', '--json']);

        expect(parsed.command).toBe('data-policy');
        expect(parsed.subcommand).toBeUndefined();
        expect(parsed.flags).toMatchObject({
            'repo-root': '.',
            json: true
        });
        expect(parsed.positionalArgs).toEqual([]);
    });

    it('keeps explicit preset arguments as positional args', () => {
        const parsed = parseArgs(['data-policy', 'lean', '--repo-root', '.']);

        expect(parsed.command).toBe('data-policy');
        expect(parsed.flags).toMatchObject({
            'repo-root': '.'
        });
        expect(parsed.positionalArgs).toEqual(['lean']);
    });
});
