import { sendToDaemon } from '@0ctx/mcp/dist/client';
import type { FlagMap } from './types';
import type { WorkstreamCommandContext } from './shared';
import { renderExtractionResultLines } from './insights-display';

export function createInsightCommands(ctx: WorkstreamCommandContext) {
    async function commandExtract(positionalArgs: string[], flags: FlagMap): Promise<number> {
        const asJson = Boolean(flags.json);
        const preview = Boolean(flags.preview);
        const action = String(positionalArgs[0] || '').trim().toLowerCase();
        const maxNodes = ctx.parsePositiveIntegerFlag(flags['max-nodes'] ?? flags.maxNodes, 12);
        const candidateKeys = ctx.parseOptionalStringFlag(flags.keys ?? flags['candidate-keys'])
            ?.split(',')
            .map((value) => value.trim())
            .filter(Boolean);

        try {
            if (action === 'session') {
                const contextId = await ctx.requireCommandContextId(flags, '0ctx extract session');
                if (!contextId) return 1;
                let sessionId = ctx.parseOptionalStringFlag(flags['session-id'] ?? flags.sessionId);
                if (!sessionId) {
                    const inferredSession = await ctx.resolveLatestSessionForCommand(contextId, flags);
                    sessionId = typeof inferredSession?.sessionId === 'string' ? inferredSession.sessionId : null;
                    if (!sessionId) {
                        console.error('No captured session found for the current workstream. Capture one session first or pass --session-id=<id>.');
                        return 1;
                    }
                    ctx.printInferredSelection(asJson, 'Using latest session', sessionId);
                }
                const method = preview ? 'previewSessionKnowledge' : 'extractSessionKnowledge';
                const result = await sendToDaemon(method, { contextId, sessionId, maxNodes, candidateKeys });
                return renderExtractionResult(ctx, asJson, preview ? '\nSession Insights Preview\n' : '\nSession Insights Save\n', `  Session: ${sessionId}`, result);
            }

            if (action === 'checkpoint') {
                let checkpointId = ctx.parseOptionalStringFlag(flags['checkpoint-id'] ?? flags.checkpointId);
                if (!checkpointId) {
                    const contextId = await ctx.requireCommandContextId(flags, '0ctx extract checkpoint');
                    if (!contextId) return 1;
                    const inferredCheckpoint = await ctx.resolveLatestCheckpointForCommand(contextId, flags);
                    checkpointId = typeof inferredCheckpoint?.checkpointId === 'string'
                        ? inferredCheckpoint.checkpointId
                        : typeof inferredCheckpoint?.id === 'string'
                            ? inferredCheckpoint.id
                            : null;
                    if (!checkpointId) {
                        console.error('No checkpoint found for the current workstream. Create one first or pass --checkpoint-id=<id>.');
                        return 1;
                    }
                    ctx.printInferredSelection(asJson, 'Using latest checkpoint', checkpointId);
                }
                const method = preview ? 'previewCheckpointKnowledge' : 'extractCheckpointKnowledge';
                const result = await sendToDaemon(method, { checkpointId, maxNodes, candidateKeys });
                return renderExtractionResult(ctx, asJson, preview ? '\nCheckpoint Insights Preview\n' : '\nCheckpoint Insights Save\n', `  Checkpoint: ${checkpointId}`, result);
            }

            console.error('Usage: 0ctx extract session [--repo-root=<path>] [--session-id=<id>] [--preview] [--keys=key1,key2] [--max-nodes=12] [--json]');
            console.error('   or: 0ctx extract checkpoint [--repo-root=<path>] [--checkpoint-id=<id>] [--preview] [--keys=key1,key2] [--max-nodes=12] [--json]');
            return 1;
        } catch (error) {
            console.error('Failed to save insights:', error instanceof Error ? error.message : String(error));
            return 1;
        }
    }

    async function commandInsights(positionalArgs: string[], flags: FlagMap): Promise<number> {
        const action = String(positionalArgs[0] || '').trim().toLowerCase();
        const asJson = Boolean(flags.json);
        if (action !== 'promote') {
            console.error('Usage: 0ctx insights promote [--repo-root=<path>] --node-id=<id> --target-context-id=<id> [--branch=<name>] [--worktree-path=<path>] [--json]');
            return 1;
        }

        const sourceContextId = await ctx.requireCommandContextId(flags, '0ctx insights promote');
        if (!sourceContextId) return 1;
        const nodeId = ctx.parseOptionalStringFlag(flags['node-id'] ?? flags.nodeId);
        const targetContextId = ctx.parseOptionalStringFlag(flags['target-context-id'] ?? flags.targetContextId);
        if (!nodeId) {
            console.error("Missing required '--node-id=<id>' for 0ctx insights promote.");
            return 1;
        }
        if (!targetContextId) {
            console.error("Missing required '--target-context-id=<id>' for 0ctx insights promote.");
            return 1;
        }

        const scope = ctx.resolveCommandWorkstreamScope(flags);
        try {
            const result = await sendToDaemon('promoteInsight', {
                contextId: targetContextId,
                sourceContextId,
                nodeId,
                branch: scope.branch,
                worktreePath: scope.worktreePath
            }) as { targetNodeId: string; type?: string; key?: string; branch?: string | null; worktreePath?: string | null; created: boolean; reused: boolean };
            return ctx.printJsonOrValue(asJson, result, () => {
                console.log('\nPromote Insight\n');
                console.log(`  Source workspace: ${sourceContextId}`);
                console.log(`  Target workspace: ${targetContextId}`);
                console.log(`  Source node:      ${nodeId}`);
                console.log(`  Target node:      ${result.targetNodeId}`);
                console.log(`  Type:             ${result.type ?? '-'}`);
                console.log(`  Scope:            ${result.worktreePath ?? result.branch ?? 'workspace'}`);
                console.log(`  Result:           ${result.created ? 'created' : 'reused'}`);
                console.log(`  Key:              ${result.key ?? '-'}`);
                console.log('');
            });
        } catch (error) {
            console.error('Failed to promote insight:', error instanceof Error ? error.message : String(error));
            return 1;
        }
    }

    return { commandExtract, commandInsights };
}

function renderExtractionResult(
    ctx: WorkstreamCommandContext,
    asJson: boolean,
    heading: string,
    subjectLine: string,
    result: unknown
): number {
    return ctx.printJsonOrValue(asJson, result, () => {
        for (const line of renderExtractionResultLines(heading, subjectLine, result as Record<string, unknown>)) {
            console.log(line);
        }
    });
}
