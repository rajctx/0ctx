import fs from 'fs';
import path from 'path';

const WORKSPACE_PACKAGES = ['core', 'daemon', 'mcp', 'cli'] as const;

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

    for (const pkg of WORKSPACE_PACKAGES) {
        const packageJsonPath = path.join(repoRoot, 'packages', pkg, 'package.json');
        if (!fs.existsSync(packageJsonPath)) {
            throw new Error(`Package file not found: ${packageJsonPath}`);
        }

        const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const oldVersion = parsed.version;
        parsed.version = bareVersion;
        fs.writeFileSync(packageJsonPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
        bumped.push(`@0ctx/${pkg} ${oldVersion} → ${bareVersion}`);
    }

    return { bumped, version: bareVersion };
}
