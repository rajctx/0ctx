import { spawnSync } from 'child_process';
import path from 'path';

export interface WorkingTreeState {
    hasUncommittedChanges: boolean;
    stagedChangeCount: number;
    unstagedChangeCount: number;
    untrackedCount: number;
}

export interface GitHeadState {
    branch: string | null;
    headRef: string | null;
    headSha: string | null;
    detached: boolean;
}

export interface GitWorktreeEntry {
    path: string;
    branch: string | null;
    headSha: string | null;
    detached: boolean;
}

export function safeGit(repoRoot: string, args: string[]): string | null {
    const result = spawnSync('git', ['-C', repoRoot, ...args], {
        encoding: 'utf8',
        windowsHide: true
    });
    if (result.status !== 0) {
        return null;
    }
    const value = String(result.stdout ?? '').trim();
    return value.length > 0 ? value : null;
}

export function getGitHeadState(repositoryRoot: string | null): GitHeadState | null {
    if (!repositoryRoot) return null;
    const headSha = safeGit(repositoryRoot, ['rev-parse', 'HEAD']);
    if (!headSha) return null;

    const headRef = safeGit(repositoryRoot, ['symbolic-ref', '-q', 'HEAD']);
    if (!headRef) {
        return {
            branch: null,
            headRef: null,
            headSha,
            detached: true
        };
    }

    const normalizedRef = headRef.trim();
    const branch = normalizedRef.startsWith('refs/heads/')
        ? normalizedRef.slice('refs/heads/'.length)
        : safeGit(repositoryRoot, ['symbolic-ref', '--short', '-q', 'HEAD']);

    return {
        branch: branch && branch !== 'HEAD' ? branch : null,
        headRef: normalizedRef,
        headSha,
        detached: false
    };
}

export function safeGitBranchExists(repoRoot: string, branch: string): boolean {
    const result = spawnSync('git', ['-C', repoRoot, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
        windowsHide: true
    });
    return result.status === 0;
}

export function safeGitDefaultBranch(repoRoot: string): string | null {
    const remoteHead = safeGit(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    if (remoteHead) {
        const normalized = remoteHead.replace(/^origin\//, '').trim();
        if (normalized) return normalized;
    }
    for (const candidate of ['main', 'master', 'trunk', 'develop']) {
        if (safeGitBranchExists(repoRoot, candidate)) {
            return candidate;
        }
    }
    return null;
}

export function getWorkingTreeState(repositoryRoot: string | null): WorkingTreeState | null {
    if (!repositoryRoot) return null;
    const porcelain = safeGit(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
    if (porcelain === null) {
        return null;
    }

    let stagedChangeCount = 0;
    let unstagedChangeCount = 0;
    let untrackedCount = 0;
    const lines = porcelain
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean);

    for (const line of lines) {
        const x = line[0] ?? ' ';
        const y = line[1] ?? ' ';
        if (x === '?' && y === '?') {
            untrackedCount += 1;
            continue;
        }
        if (x === '!' && y === '!') {
            continue;
        }
        if (x !== ' ') {
            stagedChangeCount += 1;
        }
        if (y !== ' ') {
            unstagedChangeCount += 1;
        }
    }

    return {
        hasUncommittedChanges: stagedChangeCount > 0 || unstagedChangeCount > 0 || untrackedCount > 0,
        stagedChangeCount,
        unstagedChangeCount,
        untrackedCount
    };
}

export function listGitWorktrees(repositoryRoot: string | null): GitWorktreeEntry[] | null {
    if (!repositoryRoot) return null;
    const result = spawnSync('git', ['-C', repositoryRoot, 'worktree', 'list', '--porcelain'], {
        encoding: 'utf8',
        windowsHide: true
    });
    if (result.status !== 0) {
        return null;
    }

    const lines = String(result.stdout ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim());
    const worktrees: GitWorktreeEntry[] = [];
    let current: GitWorktreeEntry | null = null;

    const flush = () => {
        if (current?.path) {
            worktrees.push(current);
        }
        current = null;
    };

    for (const line of lines) {
        if (!line) {
            flush();
            continue;
        }
        if (line.startsWith('worktree ')) {
            flush();
            const rawPath = line.slice('worktree '.length).trim();
            current = {
                path: path.resolve(rawPath),
                branch: null,
                headSha: null,
                detached: false
            };
            continue;
        }
        if (!current) continue;
        if (line.startsWith('HEAD ')) {
            current.headSha = line.slice('HEAD '.length).trim() || null;
            continue;
        }
        if (line.startsWith('branch ')) {
            const ref = line.slice('branch '.length).trim();
            current.branch = ref.startsWith('refs/heads/')
                ? ref.slice('refs/heads/'.length)
                : (ref || null);
            continue;
        }
        if (line === 'detached') {
            current.detached = true;
            current.branch = null;
        }
    }
    flush();

    return worktrees;
}
