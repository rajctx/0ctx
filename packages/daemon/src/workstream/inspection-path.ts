import path from 'path';

export function resolveGitInspectionPath(
    repositoryRoot: string | null,
    worktreePath: string | null | undefined
): string | null {
    const preferred = typeof worktreePath === 'string' && worktreePath.trim().length > 0
        ? worktreePath.trim()
        : repositoryRoot;
    if (!preferred) return null;

    try {
        return path.resolve(preferred);
    } catch {
        return preferred;
    }
}
