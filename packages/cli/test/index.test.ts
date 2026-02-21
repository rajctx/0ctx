import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('@0ctx/cli build artifact source', () => {
    it('includes expected command verbs in CLI source', () => {
        const sourcePath = path.resolve(__dirname, '..', 'src', 'index.ts');
        const source = readFileSync(sourcePath, 'utf8');

        expect(source).toContain("case 'install'");
        expect(source).toContain("case 'bootstrap'");
        expect(source).toContain("case 'doctor'");
        expect(source).toContain("case 'status'");
        expect(source).toContain("case 'repair'");
    });
});
