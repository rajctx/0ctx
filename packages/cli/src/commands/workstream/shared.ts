import path from 'path';
import { sendToDaemon } from '@0ctx/mcp/dist/client';
import type { CommandDeps, FlagMap } from './types';

export interface WorkstreamCommandContext extends CommandDeps {
    resolveCommandWorkstreamScope: (flags: FlagMap) => { repoRoot: string; branch: string | null; worktreePath: string | null };
    resolveLatestSessionForCommand: (contextId: string, flags: FlagMap) => Promise<Record<string, unknown> | null>;
    resolveLatestCheckpointForCommand: (contextId: string, flags: FlagMap) => Promise<Record<string, unknown> | null>;
    printInferredSelection: (asJson: boolean, label: string, value: string) => void;
    printJsonOrValue: (asJson: boolean, value: unknown, human: () => void) => number;
    short: (value: string, max?: number) => string;
    describeCheckoutStateHuman: (data: {
        checkedOutWorktreePaths?: string[];
        checkedOutHere?: boolean | null;
        checkedOutElsewhere?: boolean | null;
    } | null | undefined) => string | null;
}

function summarizeCheckoutPaths(paths: string[]): string {
    const unique = [...new Set(paths.map((value) => String(value || '').trim()).filter(Boolean))];
    if (unique.length === 0) return '';
    const labels = unique.slice(0, 2).map((value) => path.basename(value) || value);
    return unique.length > 2 ? `${labels.join(', ')}...` : labels.join(', ');
}

export function createWorkstreamCommandContext(deps: CommandDeps): WorkstreamCommandContext {
    function resolveCommandWorkstreamScope(flags: FlagMap): { repoRoot: string; branch: string | null; worktreePath: string | null } {
        const repoRoot = deps.resolveCommandRepoRoot(flags);
        return {
            repoRoot,
            branch: deps.parseOptionalStringFlag(flags.branch) ?? deps.getCurrentWorkstream(repoRoot),
            worktreePath: deps.parseOptionalStringFlag(flags['worktree-path'] ?? flags.worktreePath)
        };
    }

    async function resolveLatestSessionForCommand(contextId: string, flags: FlagMap): Promise<Record<string, unknown> | null> {
        const scope = resolveCommandWorkstreamScope(flags);
        const result = scope.branch
            ? await sendToDaemon('listBranchSessions', { contextId, branch: scope.branch, worktreePath: scope.worktreePath, limit: 1 })
            : await sendToDaemon('listChatSessions', { contextId, limit: 1 });
        const sessions = Array.isArray(result) ? result : [];
        return (sessions[0] as Record<string, unknown> | undefined) ?? null;
    }

    async function resolveLatestCheckpointForCommand(contextId: string, flags: FlagMap): Promise<Record<string, unknown> | null> {
        const scope = resolveCommandWorkstreamScope(flags);
        const result = scope.branch
            ? await sendToDaemon('listBranchCheckpoints', { contextId, branch: scope.branch, worktreePath: scope.worktreePath, limit: 1 })
            : await sendToDaemon('listCheckpoints', { contextId });
        const checkpoints = Array.isArray(result) ? result : [];
        return (checkpoints[0] as Record<string, unknown> | undefined) ?? null;
    }

    function printInferredSelection(asJson: boolean, label: string, value: string): void {
        if (asJson) return;
        console.log(`${label}: ${value}`);
    }

    function printJsonOrValue(asJson: boolean, value: unknown, human: () => void): number {
        if (asJson) {
            console.log(JSON.stringify(value, null, 2));
            return 0;
        }
        human();
        return 0;
    }

    function short(value: string, max = 120): string {
        return value.length > max ? `${value.slice(0, max - 3)}...` : value;
    }

    function describeCheckoutStateHuman(data: {
        checkedOutWorktreePaths?: string[];
        checkedOutHere?: boolean | null;
        checkedOutElsewhere?: boolean | null;
    } | null | undefined): string | null {
        if (!data) return null;
        const paths = Array.isArray(data.checkedOutWorktreePaths) ? data.checkedOutWorktreePaths : [];
        if (data.checkedOutHere === true && data.checkedOutElsewhere === true) {
            const elsewhereCount = Math.max(0, paths.length - 1);
            return elsewhereCount > 0 ? `checked out here + ${elsewhereCount} other worktree${elsewhereCount === 1 ? '' : 's'}` : 'checked out here';
        }
        if (data.checkedOutHere === true) return 'checked out here';
        if (data.checkedOutElsewhere === true) {
            const labels = summarizeCheckoutPaths(paths);
            return labels ? `checked out elsewhere (${labels})` : 'checked out elsewhere';
        }
        if (paths.length === 0) return 'not checked out in a known worktree';
        return null;
    }

    return {
        ...deps,
        resolveCommandWorkstreamScope,
        resolveLatestSessionForCommand,
        resolveLatestCheckpointForCommand,
        printInferredSelection,
        printJsonOrValue,
        short,
        describeCheckoutStateHuman
    };
}
