import path from 'path';
import { execSync } from 'child_process';

export function findGitRepoRoot(input: string | null): string | null {
    const cwd = input ? path.resolve(input) : process.cwd();
    try {
        const root = execSync('git rev-parse --show-toplevel', {
            cwd,
            stdio: ['ignore', 'pipe', 'ignore']
        }).toString().trim();
        return root.length > 0 ? root : null;
    } catch {
        return null;
    }
}

export function resolveRepoRoot(input: string | null): string {
    if (input) {
        const resolved = path.resolve(input);
        return findGitRepoRoot(resolved) ?? resolved;
    }
    return findGitRepoRoot(null) ?? process.cwd();
}

export function safeGitValue(repoRoot: string, args: string[]): string | null {
    try {
        const value = execSync(`git ${args.join(' ')}`, {
            cwd: repoRoot,
            stdio: ['ignore', 'pipe', 'ignore']
        }).toString().trim();
        if (!value || value === 'HEAD') return null;
        return value;
    } catch {
        return null;
    }
}

export function getCurrentWorkstream(repoRoot: string): string | null {
    return safeGitValue(repoRoot, ['branch', '--show-current'])
        ?? safeGitValue(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
}
