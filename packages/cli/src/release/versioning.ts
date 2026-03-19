import fs from 'fs';
import path from 'path';

const RELEASE_SURFACES = [
    { name: '@0ctx/core', packageJsonPath: ['packages', 'core', 'package.json'] },
    { name: '@0ctx/daemon', packageJsonPath: ['packages', 'daemon', 'package.json'] },
    { name: '@0ctx/mcp', packageJsonPath: ['packages', 'mcp', 'package.json'] },
    { name: '@0ctx/cli', packageJsonPath: ['packages', 'cli', 'package.json'] },
    { name: '@0ctx/desktop-electron', packageJsonPath: ['desktop-app', 'package.json'] }
] as const;

export interface VersionBumpResult {
    bumped: string[];
    version: string;
}

export function normalizeReleaseVersion(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) throw new Error('Missing required version (expected vX.Y.Z).');
    return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

export function validateReleaseVersion(input: string): string {
    const normalized = normalizeReleaseVersion(input);
    if (!/^v\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(normalized)) {
        throw new Error(`Invalid version '${input}'. Expected vX.Y.Z or vX.Y.Z-prerelease.`);
    }
    return normalized;
}

export function bumpAllPackageVersions(repoRoot: string, taggedVersion: string): VersionBumpResult {
    const bareVersion = taggedVersion.startsWith('v') ? taggedVersion.slice(1) : taggedVersion;
    const bumped: string[] = [];

    for (const surface of RELEASE_SURFACES) {
        const packageJsonPath = path.join(repoRoot, ...surface.packageJsonPath);
        if (!fs.existsSync(packageJsonPath)) {
            throw new Error(`Package file not found: ${packageJsonPath}`);
        }

        const originalContent = fs.readFileSync(packageJsonPath, 'utf-8');
        const parsed = JSON.parse(originalContent);
        const oldVersion = parsed.version;
        if (oldVersion !== bareVersion) {
            parsed.version = bareVersion;
            const newline = originalContent.includes('\r\n') ? '\r\n' : '\n';
            const nextContent = JSON.stringify(parsed, null, 2).replace(/\n/g, newline) + newline;
            fs.writeFileSync(packageJsonPath, nextContent, 'utf-8');
        }
        bumped.push(`${surface.name} ${oldVersion} -> ${bareVersion}`);
    }

    return { bumped, version: bareVersion };
}
