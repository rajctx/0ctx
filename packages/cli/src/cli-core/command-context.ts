interface CommandContextDeps {
    parseOptionalStringFlag: (value: string | boolean | undefined) => string | null;
    resolveRepoRoot: (input: string | null) => string;
    sendToDaemon: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
    selectHookContextId: (
        contexts: Array<{ id?: string; name?: string; paths?: string[] }>,
        repoRoot: string,
        preferredContextId: string | null
    ) => string | null;
}

export function getContextIdFlag(flags: Record<string, string | boolean>): string | null {
    const contextId = flags['context-id'] ?? flags.contextId;
    if (typeof contextId === 'string' && contextId.trim().length > 0) {
        return contextId.trim();
    }
    return null;
}

export function resolveCommandRepoRoot(
    flags: Record<string, string | boolean>,
    deps: Pick<CommandContextDeps, 'parseOptionalStringFlag' | 'resolveRepoRoot'>
): string {
    return deps.resolveRepoRoot(deps.parseOptionalStringFlag(flags['repo-root'] ?? flags.repoRoot));
}

export function createCommandContextResolver(deps: CommandContextDeps) {
    async function resolveCommandContextId(
        flags: Record<string, string | boolean>
    ): Promise<string | null> {
        const explicit = getContextIdFlag(flags);
        if (explicit) return explicit;

        const requestedRepoRoot = deps.parseOptionalStringFlag(flags['repo-root'] ?? flags.repoRoot);
        try {
            const contexts = await deps.sendToDaemon('listContexts', {}) as Array<{ id?: string; paths?: string[] }> | null;
            if (Array.isArray(contexts)) {
                const repoRoot = deps.resolveRepoRoot(requestedRepoRoot);
                const byRepo = deps.selectHookContextId(contexts, repoRoot, null);
                if (byRepo) return byRepo;
            }
        } catch {
            return null;
        }
        return null;
    }

    async function requireCommandContextId(
        flags: Record<string, string | boolean>,
        commandLabel: string
    ): Promise<string | null> {
        const contextId = await resolveCommandContextId(flags);
        if (!contextId) {
            console.error(`Missing workspace for \`${commandLabel}\`. Run this inside a bound repo, pass '--repo-root=<path>', or use '--context-id=<contextId>' for support workflows.`);
            return null;
        }
        return contextId;
    }

    return {
        resolveCommandContextId,
        requireCommandContextId
    };
}
