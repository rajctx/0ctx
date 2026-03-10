import path from 'path';
import { sendToDaemon } from './client';

interface ContextSummary {
    id?: string;
    paths?: string[];
}

const TOOL_CONTEXT_PATH_KEYS = [
    'worktreePath',
    'repositoryRoot',
    'repoRoot',
    'sourceWorktreePath',
    'targetWorktreePath'
] as const;

function normalizePath(candidate: string | null | undefined): string | null {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) return null;
    return path.resolve(candidate).toLowerCase();
}

export function selectContextIdForWorkingDirectory(
    contexts: ContextSummary[] | null | undefined,
    workingDirectory: string | null | undefined
): string | null {
    const normalizedWorkingDirectory = normalizePath(workingDirectory);
    if (!normalizedWorkingDirectory || !Array.isArray(contexts)) return null;

    const matched = contexts.find((context) =>
        (context.paths ?? []).some((rawPath) => {
            const normalizedPath = normalizePath(rawPath);
            if (!normalizedPath) return false;
            return normalizedWorkingDirectory === normalizedPath
                || normalizedWorkingDirectory.startsWith(`${normalizedPath}${path.sep}`);
        })
    );

    return typeof matched?.id === 'string' && matched.id.trim().length > 0 ? matched.id : null;
}

function pickStringArg(args: Record<string, unknown> | null | undefined, key: string): string | null {
    const value = args?.[key];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function hasToolContextPathHints(args: Record<string, unknown> | null | undefined): boolean {
    return TOOL_CONTEXT_PATH_KEYS.some((key) => Boolean(pickStringArg(args, key)));
}

export function selectContextIdForToolArgs(
    contexts: ContextSummary[] | null | undefined,
    args: Record<string, unknown> | null | undefined
): string | null {
    const explicitContextId = pickStringArg(args, 'contextId');
    if (explicitContextId) return explicitContextId;

    const explicitSourceContextId = pickStringArg(args, 'sourceContextId');
    if (explicitSourceContextId) return explicitSourceContextId;

    if (!Array.isArray(contexts)) return null;

    for (const key of TOOL_CONTEXT_PATH_KEYS) {
        const candidatePath = pickStringArg(args, key);
        if (!candidatePath) continue;
        const matchedContextId = selectContextIdForWorkingDirectory(contexts, candidatePath);
        if (matchedContextId) return matchedContextId;
    }

    return null;
}

export async function resolveInitialSessionContextId(
    workingDirectory = process.cwd()
): Promise<string | null> {
    try {
        const contexts = await sendToDaemon('listContexts', {}) as Array<ContextSummary> | null;
        return selectContextIdForWorkingDirectory(contexts, workingDirectory);
    } catch {
        return null;
    }
}

export async function resolveRequestSessionContextId(
    args: Record<string, unknown> | null | undefined,
    listContexts: () => Promise<ContextSummary[] | null>
): Promise<string | null> {
    const explicitContextId = selectContextIdForToolArgs(null, args);
    if (explicitContextId) return explicitContextId;
    if (!hasToolContextPathHints(args)) return null;

    try {
        return selectContextIdForToolArgs(await listContexts(), args);
    } catch {
        return null;
    }
}
