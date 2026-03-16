import path from 'path';
import { pickString } from './shared';
import { GENERIC_CAPTURE_ROOT_KEYS, type HookAgent } from './types';

export function resolveHookCaptureRoot(
    agent: HookAgent,
    payload: Record<string, unknown>,
    repoRootFallback: string | null = null
): string | null {
    const rootKeys = agent === 'codex'
        ? ['cwd', 'workspace.cwd', ...GENERIC_CAPTURE_ROOT_KEYS]
        : GENERIC_CAPTURE_ROOT_KEYS;
    const rawRoot = rootKeys.length > 0 ? pickString(payload, rootKeys) : null;
    const candidate = rawRoot ?? repoRootFallback;
    if (!candidate || candidate.trim().length === 0) {
        return null;
    }
    return path.resolve(candidate);
}

export function selectHookContextId(
    contexts: Array<{ id?: string; paths?: string[] }>,
    repoRoot: string | null,
    explicitContextId: string | null
): string | null {
    if (explicitContextId) {
        const explicit = contexts.find((context) => typeof context?.id === 'string' && context.id === explicitContextId);
        if (explicit?.id) {
            return explicit.id;
        }
    }

    if (repoRoot) {
        const normalizedRoot = path.resolve(repoRoot).toLowerCase();
        const byPath = contexts.find((context) => (context.paths ?? []).some((rawPath) => {
            const normalizedPath = path.resolve(rawPath).toLowerCase();
            return normalizedRoot === normalizedPath || normalizedRoot.startsWith(`${normalizedPath}${path.sep}`);
        }));
        if (byPath?.id) {
            return byPath.id;
        }
    }

    return null;
}

export function matchesHookCaptureRoot(contextPaths: string[], captureRoot: string | null): boolean {
    if (!captureRoot) return true;
    if (!Array.isArray(contextPaths) || contextPaths.length === 0) return true;

    const normalizedRoot = path.resolve(captureRoot).toLowerCase();
    return contextPaths.some((rawPath) => {
        const normalizedPath = path.resolve(rawPath).toLowerCase();
        return normalizedRoot === normalizedPath || normalizedRoot.startsWith(`${normalizedPath}${path.sep}`);
    });
}
