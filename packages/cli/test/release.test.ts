import { describe, expect, it } from 'vitest';
import { normalizeReleaseVersion, validateReleaseVersion } from '../src/release';

describe('release version helpers', () => {
    it('normalizes missing v prefix', () => {
        expect(normalizeReleaseVersion('1.2.3')).toBe('v1.2.3');
        expect(normalizeReleaseVersion('v1.2.3')).toBe('v1.2.3');
    });

    it('validates stable and prerelease versions', () => {
        expect(validateReleaseVersion('v1.2.3')).toBe('v1.2.3');
        expect(validateReleaseVersion('1.2.3-rc.1')).toBe('v1.2.3-rc.1');
    });

    it('rejects invalid versions', () => {
        expect(() => validateReleaseVersion('abc')).toThrowError(/Invalid version/);
        expect(() => validateReleaseVersion('v1')).toThrowError(/Invalid version/);
    });
});
