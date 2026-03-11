import type { RepoReadinessSummary } from '@0ctx/core';

export function createRepoReadinessCollector(deps: {
    ensureDaemonCapabilities: (methods: string[]) => Promise<{ ok: boolean; missingMethods: string[]; error?: string | null }>;
    resolveRepoRoot: (repoRoot?: string | null | undefined) => string;
    sendToDaemon: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
}) {
    return async function collectRepoReadiness(options: {
        repoRoot?: string | null;
        contextId?: string | null;
    } = {}): Promise<RepoReadinessSummary | null> {
        const capabilityCheck = await deps.ensureDaemonCapabilities(['getRepoReadiness']);
        if (!capabilityCheck.ok) {
            throw new Error(`daemon capabilities stale: ${capabilityCheck.missingMethods.join(', ') || capabilityCheck.error || 'unknown'}`);
        }

        const repoRoot = deps.resolveRepoRoot(options.repoRoot ?? null);
        return deps.sendToDaemon<RepoReadinessSummary>('getRepoReadiness', {
            repoRoot,
            contextId: options.contextId ?? null
        });
    };
}
