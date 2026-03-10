import path from 'path';
import { sendToDaemon } from './client';

interface ContextSummary {
    id?: string;
    paths?: string[];
}

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
