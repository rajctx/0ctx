import { sendToDaemon } from '@0ctx/mcp/dist/client';
import type { FlagMap } from './types';
import type { WorkstreamCommandContext } from './shared';

export function createCheckpointCommands(ctx: WorkstreamCommandContext) {
    async function commandCheckpoints(subcommand: string | undefined, flags: FlagMap): Promise<number> {
        const contextId = await ctx.requireCommandContextId(flags, '0ctx checkpoints');
        if (!contextId) return 1;
        const asJson = Boolean(flags.json);
        const action = (subcommand ?? 'list').toLowerCase();
        const checkpointId = ctx.parseOptionalStringFlag(flags['checkpoint-id'] ?? flags.checkpointId);
        const branch = ctx.parseOptionalStringFlag(flags.branch);
        const worktreePath = ctx.parseOptionalStringFlag(flags['worktree-path'] ?? flags.worktreePath);
        const sessionId = ctx.parseOptionalStringFlag(flags['session-id'] ?? flags.sessionId);
        const name = ctx.parseOptionalStringFlag(flags.name);
        const summary = ctx.parseOptionalStringFlag(flags.summary);
        const limit = ctx.parsePositiveIntegerFlag(flags.limit, 100);

        try {
            if (action === 'create') {
                let effectiveSessionId = sessionId;
                if (!effectiveSessionId) {
                    const inferredSession = await ctx.resolveLatestSessionForCommand(contextId, flags);
                    effectiveSessionId = typeof inferredSession?.sessionId === 'string' ? inferredSession.sessionId : null;
                    if (!effectiveSessionId) {
                        console.error('No captured session found for the current workstream. Capture one session first or pass --session-id=<id>.');
                        return 1;
                    }
                    ctx.printInferredSelection(asJson, 'Using latest session', effectiveSessionId);
                }
                const result = await sendToDaemon('createSessionCheckpoint', { contextId, sessionId: effectiveSessionId, name, summary });
                return ctx.printJsonOrValue(asJson, result, () => {
                    const checkpoint = result as { id?: string; branch?: string | null; commitSha?: string | null; summary?: string | null };
                    console.log('\nCheckpoint Created\n');
                    console.log(`  Id: ${checkpoint.id ?? '-'}`);
                    console.log(`  Workstream: ${checkpoint.branch ?? '-'}`);
                    console.log(`  Commit: ${checkpoint.commitSha ?? '-'}`);
                    console.log(`  Summary: ${checkpoint.summary ?? '-'}`);
                    console.log('');
                });
            }

            if (action === 'show' || action === 'detail') {
                let effectiveCheckpointId = checkpointId;
                if (!effectiveCheckpointId) {
                    const inferredCheckpoint = await ctx.resolveLatestCheckpointForCommand(contextId, flags);
                    effectiveCheckpointId = typeof inferredCheckpoint?.checkpointId === 'string'
                        ? inferredCheckpoint.checkpointId
                        : typeof inferredCheckpoint?.id === 'string'
                            ? inferredCheckpoint.id
                            : null;
                    if (!effectiveCheckpointId) {
                        console.error('No checkpoint found for the current workstream. Create one first or pass --checkpoint-id=<id>.');
                        return 1;
                    }
                    ctx.printInferredSelection(asJson, 'Using latest checkpoint', effectiveCheckpointId);
                }
                const result = await sendToDaemon('getCheckpointDetail', { contextId, checkpointId: effectiveCheckpointId });
                return ctx.printJsonOrValue(asJson, result, () => {
                    const detail = result as { checkpoint?: Record<string, unknown>; snapshotNodeCount?: number };
                    console.log('\nCheckpoint Detail\n');
                    console.log(`  Id: ${effectiveCheckpointId}`);
                    console.log(`  Name: ${String(detail.checkpoint?.name ?? '-')}`);
                    console.log(`  Kind: ${String(detail.checkpoint?.kind ?? '-')}`);
                    console.log(`  Workstream: ${String(detail.checkpoint?.branch ?? '-')}`);
                    console.log(`  Session: ${String(detail.checkpoint?.sessionId ?? '-')}`);
                    console.log(`  Snapshot nodes: ${String(detail.snapshotNodeCount ?? 0)}`);
                    console.log('');
                });
            }

            const result = branch
                ? await sendToDaemon('listBranchCheckpoints', { contextId, branch, worktreePath, limit })
                : await sendToDaemon('listCheckpoints', { contextId });
            const checkpoints = Array.isArray(result) ? result : [];
            return ctx.printJsonOrValue(asJson, checkpoints, () => {
                console.log('\nCheckpoints\n');
                if (!checkpoints.length) {
                    console.log('  No checkpoints found.\n');
                    return;
                }
                for (const checkpoint of checkpoints as Array<Record<string, unknown>>) {
                    console.log(`  ${String(checkpoint.id ?? checkpoint.checkpointId ?? '-')}`);
                    console.log(`    ${String(checkpoint.summary ?? checkpoint.name ?? '-')}`);
                    console.log(`    Workstream: ${String(checkpoint.branch ?? '-')}`);
                    console.log(`    Session: ${String(checkpoint.sessionId ?? '-')}`);
                    console.log(`    Kind: ${String(checkpoint.kind ?? '-')}`);
                    console.log(`    Created: ${checkpoint.createdAt ? new Date(Number(checkpoint.createdAt)).toLocaleString() : '-'}`);
                    console.log('');
                }
            });
        } catch (error) {
            console.error('Failed to inspect checkpoints:', error instanceof Error ? error.message : String(error));
            return 1;
        }
    }

    async function commandResume(flags: FlagMap): Promise<number> {
        const contextId = await ctx.requireCommandContextId(flags, '0ctx resume');
        if (!contextId) return 1;
        let sessionId = ctx.parseOptionalStringFlag(flags['session-id'] ?? flags.sessionId);
        const asJson = Boolean(flags.json);
        if (!sessionId) {
            const inferredSession = await ctx.resolveLatestSessionForCommand(contextId, flags);
            sessionId = typeof inferredSession?.sessionId === 'string' ? inferredSession.sessionId : null;
            if (!sessionId) {
                console.error('No captured session found for the current workstream. Capture one session first or pass --session-id=<id>.');
                return 1;
            }
            ctx.printInferredSelection(asJson, 'Using latest session', sessionId);
        }
        try {
            const result = await sendToDaemon('resumeSession', { contextId, sessionId });
            return ctx.printJsonOrValue(asJson, result, () => {
                const detail = result as { session?: Record<string, unknown>; checkpointCount?: number };
                console.log('\nResume Session\n');
                console.log(`  Session: ${sessionId}`);
                console.log(`  Summary: ${String(detail.session?.summary ?? '-')}`);
                console.log(`  Workstream: ${String(detail.session?.branch ?? '-')}`);
                console.log(`  Agent: ${String(detail.session?.agent ?? '-')}`);
                console.log(`  Checkpoints: ${String(detail.checkpointCount ?? 0)}`);
                console.log('');
            });
        } catch (error) {
            console.error('Failed to resume session:', error instanceof Error ? error.message : String(error));
            return 1;
        }
    }

    async function commandRewind(flags: FlagMap): Promise<number> {
        const contextId = await ctx.requireCommandContextId(flags, '0ctx rewind');
        if (!contextId) return 1;
        let checkpointId = ctx.parseOptionalStringFlag(flags['checkpoint-id'] ?? flags.checkpointId);
        const asJson = Boolean(flags.json);
        if (!checkpointId) {
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
        try {
            const result = await sendToDaemon('rewindCheckpoint', { contextId, checkpointId });
            return ctx.printJsonOrValue(asJson, result, () => {
                const detail = result as { checkpoint?: Record<string, unknown> };
                console.log('\nRewind Complete\n');
                console.log(`  Checkpoint: ${checkpointId}`);
                console.log(`  Name: ${String(detail.checkpoint?.name ?? '-')}`);
                console.log(`  Workstream: ${String(detail.checkpoint?.branch ?? '-')}`);
                console.log('');
            });
        } catch (error) {
            console.error('Failed to rewind checkpoint:', error instanceof Error ? error.message : String(error));
            return 1;
        }
    }

    async function commandExplain(flags: FlagMap): Promise<number> {
        const contextId = await ctx.requireCommandContextId(flags, '0ctx explain');
        if (!contextId) return 1;
        let checkpointId = ctx.parseOptionalStringFlag(flags['checkpoint-id'] ?? flags.checkpointId);
        const asJson = Boolean(flags.json);
        if (!checkpointId) {
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
        try {
            const result = await sendToDaemon('explainCheckpoint', { contextId, checkpointId });
            return ctx.printJsonOrValue(asJson, result, () => {
                const detail = result as { checkpoint?: Record<string, unknown>; snapshotNodeCount?: number; snapshotEdgeCount?: number; snapshotCheckpointCount?: number };
                console.log('\nCheckpoint Explanation\n');
                console.log(`  Checkpoint: ${checkpointId}`);
                console.log(`  Summary: ${String(detail.checkpoint?.summary ?? detail.checkpoint?.name ?? '-')}`);
                console.log(`  Workstream: ${String(detail.checkpoint?.branch ?? '-')}`);
                console.log(`  Session: ${String(detail.checkpoint?.sessionId ?? '-')}`);
                console.log(`  Snapshot nodes: ${String(detail.snapshotNodeCount ?? 0)}`);
                console.log(`  Snapshot edges: ${String(detail.snapshotEdgeCount ?? 0)}`);
                console.log(`  Snapshot checkpoints: ${String(detail.snapshotCheckpointCount ?? 0)}`);
                console.log('');
            });
        } catch (error) {
            console.error('Failed to explain checkpoint:', error instanceof Error ? error.message : String(error));
            return 1;
        }
    }

    return { commandCheckpoints, commandResume, commandRewind, commandExplain };
}
