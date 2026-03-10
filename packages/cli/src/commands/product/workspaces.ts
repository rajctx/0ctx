import type { FlagMap, ProductCommandDeps } from './types';
import { buildWorkspaceCompareFlowLines } from './workspace-compare-display';

interface WorkspaceRecord {
    id?: string;
    name?: string;
    paths?: string[];
    syncPolicy?: string | null;
}

function describeWorkspace(workspace: WorkspaceRecord | undefined, fallbackId: string): string {
    const label = typeof workspace?.name === 'string' && workspace.name.trim().length > 0
        ? workspace.name.trim()
        : fallbackId;
    return workspace?.id && workspace.id !== label ? `${label} (${workspace.id})` : label;
}

function resolveWorkspaceContextId(
    deps: ProductCommandDeps,
    contexts: WorkspaceRecord[],
    explicitContextId: string | null,
    repoRoot: string | null
): string | null {
    if (explicitContextId) return explicitContextId;
    if (!repoRoot) return null;
    return deps.selectHookContextId(contexts, repoRoot, null);
}

export function createWorkspaceCommands(deps: ProductCommandDeps) {
    async function commandWorkspaces(args: string[], flags: FlagMap): Promise<number> {
        const subcommand = String(args[0] || '').trim().toLowerCase();
        if (subcommand !== 'compare') {
            console.error('Usage: 0ctx workspaces compare [--repo-root=<path>|--source-context-id=<id>] (--target-context-id=<id>|--target-repo-root=<path>) [--json]');
            return 1;
        }

        const asJson = Boolean(flags.json);
        const sourceContextIdFlag = deps.parseOptionalStringFlag(flags['source-context-id'] ?? flags.sourceContextId);
        const targetContextIdFlag = deps.parseOptionalStringFlag(flags['target-context-id'] ?? flags.targetContextId);
        const sourceRepoRootInput = deps.parseOptionalStringFlag(
            flags['repo-root'] ?? flags.repoRoot ?? flags['source-repo-root'] ?? flags.sourceRepoRoot
        );
        const targetRepoRootInput = deps.parseOptionalStringFlag(flags['target-repo-root'] ?? flags.targetRepoRoot);

        const contexts = await deps.sendToDaemon<WorkspaceRecord[]>('listContexts', {});
        const sourceRepoRoot = sourceRepoRootInput ? deps.resolveRepoRoot(sourceRepoRootInput) : null;
        const targetRepoRoot = targetRepoRootInput ? deps.resolveRepoRoot(targetRepoRootInput) : null;

        const sourceContextId = resolveWorkspaceContextId(deps, contexts, sourceContextIdFlag, sourceRepoRoot);
        const targetContextId = resolveWorkspaceContextId(deps, contexts, targetContextIdFlag, targetRepoRoot);

        if (!sourceContextId) {
            console.error('Missing source workspace. Pass --source-context-id=<id>, --repo-root=<path>, or run inside a bound repo.');
            return 1;
        }
        if (!targetContextId) {
            console.error('Missing target workspace. Pass --target-context-id=<id> or --target-repo-root=<path>.');
            return 1;
        }

        const sourceWorkspace = contexts.find((context) => context.id === sourceContextId);
        const targetWorkspace = contexts.find((context) => context.id === targetContextId);
        const comparison = await deps.sendToDaemon<Record<string, unknown>>('compareWorkspaces', {
            sourceContextId,
            targetContextId
        });

        return deps.printJsonOrValue(asJson, comparison, () => {
            const sharedRepositoryPaths = Array.isArray(comparison.sharedRepositoryPaths)
                ? comparison.sharedRepositoryPaths as string[]
                : [];
            const sharedAgents = Array.isArray(comparison.sharedAgents)
                ? comparison.sharedAgents as string[]
                : [];
            const sourceOnlyAgents = Array.isArray(comparison.sourceOnlyAgents)
                ? comparison.sourceOnlyAgents as string[]
                : [];
            const targetOnlyAgents = Array.isArray(comparison.targetOnlyAgents)
                ? comparison.targetOnlyAgents as string[]
                : [];
            const sharedWorkstreams = Array.isArray(comparison.sharedWorkstreams)
                ? comparison.sharedWorkstreams as string[]
                : [];
            const sharedInsights = Array.isArray(comparison.sharedInsights)
                ? comparison.sharedInsights as string[]
                : [];

            console.log('\nWorkspace comparison\n');
            console.log(`  Source:   ${describeWorkspace(sourceWorkspace, sourceContextId)}`);
            console.log(`  Target:   ${describeWorkspace(targetWorkspace, targetContextId)}`);
            console.log(`  Sync:     ${deps.formatSyncPolicyLabel(sourceWorkspace?.syncPolicy)} vs ${deps.formatSyncPolicyLabel(targetWorkspace?.syncPolicy)}`);
            console.log(`  Kind:     ${String(comparison.comparisonKind ?? 'unknown')}`);
            console.log(`  Summary:  ${String(comparison.comparisonSummary ?? '-')}`);
            if (sharedRepositoryPaths.length > 0) {
                console.log(`  Shared repos: ${sharedRepositoryPaths.join(', ')}`);
            }
            if (sharedWorkstreams.length > 0) {
                console.log(`  Shared workstreams: ${sharedWorkstreams.join(', ')}`);
            }
            if (sharedAgents.length > 0) {
                console.log(`  Shared agents: ${sharedAgents.join(', ')}`);
            }
            if (sourceOnlyAgents.length > 0) {
                console.log(`  Source only agents: ${sourceOnlyAgents.join(', ')}`);
            }
            if (targetOnlyAgents.length > 0) {
                console.log(`  Target only agents: ${targetOnlyAgents.join(', ')}`);
            }
            if (sharedInsights.length > 0) {
                console.log('  Shared reviewed insights:');
                for (const insight of sharedInsights.slice(0, 6)) {
                    console.log(`    - ${insight}`);
                }
            }
            if (comparison.comparisonActionHint) {
                console.log(`  Next:     ${String(comparison.comparisonActionHint)}`);
            }
            for (const line of buildWorkspaceCompareFlowLines(comparison as {
                source: { contextId: string };
                target: { contextId: string };
            })) {
                console.log(line);
            }
            if (comparison.comparisonText) {
                console.log(`\n  ${String(comparison.comparisonText).split('\n').join('\n  ')}\n`);
            } else {
                console.log('');
            }
        });
    }

    return { commandWorkspaces };
}
