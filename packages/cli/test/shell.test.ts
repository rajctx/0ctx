import { describe, expect, it } from 'vitest';
import { tokenizeShellInput } from '../src/shell';

describe('tokenizeShellInput', () => {
    it('splits simple tokens', () => {
        expect(tokenizeShellInput('status')).toEqual(['status']);
        expect(tokenizeShellInput('connector verify --require-cloud')).toEqual([
            'connector',
            'verify',
            '--require-cloud'
        ]);
    });

    it('supports quoted values', () => {
        expect(tokenizeShellInput('config set ui.url "https://app.0ctx.com/path?q=1"')).toEqual([
            'config',
            'set',
            'ui.url',
            'https://app.0ctx.com/path?q=1'
        ]);
    });

    it('throws for unterminated quotes', () => {
        expect(() => tokenizeShellInput('config set ui.url "https://app.0ctx.com')).toThrowError(
            'Unterminated quoted string.'
        );
    });
});
