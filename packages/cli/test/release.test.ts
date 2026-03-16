import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    normalizeReleaseVersion,
    validateReleaseVersion,
    bumpAllPackageVersions
} from '../src/release';

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

describe('bumpAllPackageVersions', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '0ctx-bump-test-'));
        const packages = ['core', 'daemon', 'mcp', 'cli'];
        for (const pkg of packages) {
            const dir = path.join(tmpDir, 'packages', pkg);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(
                path.join(dir, 'package.json'),
                JSON.stringify({ name: `@0ctx/${pkg}`, version: '0.1.0', private: true }, null, 2) + '\n',
                'utf-8'
            );
        }
        fs.mkdirSync(path.join(tmpDir, 'desktop-app'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'desktop-app', 'package.json'),
            JSON.stringify({ name: '@0ctx/desktop-electron', version: '0.1.0', private: true }, null, 2) + '\n',
            'utf-8'
        );
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('bumps all release surfaces to the target version', () => {
        const result = bumpAllPackageVersions(tmpDir, 'v0.2.0');
        expect(result.version).toBe('0.2.0');
        expect(result.bumped).toHaveLength(5);

        for (const pkg of ['core', 'daemon', 'mcp', 'cli']) {
            const content = JSON.parse(fs.readFileSync(
                path.join(tmpDir, 'packages', pkg, 'package.json'),
                'utf-8'
            ));
            expect(content.version).toBe('0.2.0');
        }

        const desktopContent = JSON.parse(fs.readFileSync(
            path.join(tmpDir, 'desktop-app', 'package.json'),
            'utf-8'
        ));
        expect(desktopContent.version).toBe('0.2.0');
    });

    it('strips v prefix for package.json versions', () => {
        const result = bumpAllPackageVersions(tmpDir, 'v1.0.0-rc.1');
        expect(result.version).toBe('1.0.0-rc.1');

        const content = JSON.parse(fs.readFileSync(
            path.join(tmpDir, 'packages', 'cli', 'package.json'),
            'utf-8'
        ));
        expect(content.version).toBe('1.0.0-rc.1');
    });

    it('works with bare version (no v prefix)', () => {
        const result = bumpAllPackageVersions(tmpDir, '0.3.0');
        expect(result.version).toBe('0.3.0');
    });

    it('throws when a package.json is missing', () => {
        fs.rmSync(path.join(tmpDir, 'packages', 'core'), { recursive: true });
        expect(() => bumpAllPackageVersions(tmpDir, 'v0.2.0')).toThrowError(/not found/);
    });

    it('preserves other fields in package.json', () => {
        bumpAllPackageVersions(tmpDir, 'v0.5.0');
        const content = JSON.parse(fs.readFileSync(
            path.join(tmpDir, 'packages', 'cli', 'package.json'),
            'utf-8'
        ));
        expect(content.name).toBe('@0ctx/cli');
        expect(content.private).toBe(true);
        expect(content.version).toBe('0.5.0');
    });

    it('writes file with trailing newline', () => {
        bumpAllPackageVersions(tmpDir, 'v0.5.0');
        const raw = fs.readFileSync(
            path.join(tmpDir, 'packages', 'cli', 'package.json'),
            'utf-8'
        );
        expect(raw.endsWith('\n')).toBe(true);
    });

    it('updates the desktop app version along with the CLI release surface', () => {
        const result = bumpAllPackageVersions(tmpDir, 'v0.6.0');
        expect(result.bumped).toContain('@0ctx/desktop-electron 0.1.0 -> 0.6.0');

        const desktopContent = JSON.parse(fs.readFileSync(
            path.join(tmpDir, 'desktop-app', 'package.json'),
            'utf-8'
        ));
        expect(desktopContent.version).toBe('0.6.0');
    });
});
