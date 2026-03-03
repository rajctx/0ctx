import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('auth command ops logging', () => {
    it('records login/logout/rotate operations into the CLI ops log', () => {
        const sourcePath = path.resolve(__dirname, '..', 'src', 'auth.ts');
        const source = readFileSync(sourcePath, 'utf8');

        expect(source).toContain("recordAuthOpsEvent('auth.login'");
        expect(source).toContain("recordAuthOpsEvent('auth.logout'");
        expect(source).toContain("recordAuthOpsEvent('auth.rotate'");
    });
});
