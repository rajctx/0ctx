import { sendToDaemon } from '@0ctx/mcp/dist/client';
import type { FlagMap } from './types';
import type { WorkstreamCommandContext } from './shared';

export function createSessionCommands(ctx: WorkstreamCommandContext) {
    async function commandSessions(flags: FlagMap): Promise<number> {
        const contextId = await ctx.requireCommandContextId(flags, '0ctx sessions');
        if (!contextId) return 1;
        const asJson = Boolean(flags.json);
        const sessionId = ctx.parseOptionalStringFlag(flags['session-id'] ?? flags.sessionId);
        const branch = ctx.parseOptionalStringFlag(flags.branch);
        const worktreePath = ctx.parseOptionalStringFlag(flags['worktree-path'] ?? flags.worktreePath);
        const limit = ctx.parsePositiveIntegerFlag(flags.limit, 100);

        try {
            if (sessionId) {
                const detail = await sendToDaemon('getSessionDetail', { contextId, sessionId }) as {
                    session: { summary?: string; agent?: string | null; branch?: string | null; turnCount?: number; commitSha?: string | null } | null;
                    messages: Array<{ role?: string | null; content?: string; createdAt?: number }>;
                    checkpointCount: number;
                };
                return ctx.printJsonOrValue(asJson, detail, () => {
                    console.log('\nSession Detail\n');
                    console.log(`  Session: ${sessionId}`);
                    console.log(`  Summary: ${detail.session?.summary ?? '-'}`);
                    console.log(`  Agent: ${detail.session?.agent ?? '-'}`);
                    console.log(`  Workstream: ${detail.session?.branch ?? '-'}`);
                    console.log(`  Commit: ${detail.session?.commitSha ?? '-'}`);
                    console.log(`  Messages: ${detail.messages.length}`);
                    console.log(`  Checkpoints: ${detail.checkpointCount}`);
                    console.log('');
                    for (const message of detail.messages.slice(0, 20)) {
                        console.log(`  [${message.role ?? 'unknown'}] ${ctx.short(String(message.content ?? ''), 180)}`);
                    }
                    console.log('');
                });
            }

            const result = branch
                ? await sendToDaemon('listBranchSessions', { contextId, branch, worktreePath, limit })
                : await sendToDaemon('listChatSessions', { contextId, limit });
            const sessions = Array.isArray(result) ? result : [];
            return ctx.printJsonOrValue(asJson, sessions, () => {
                console.log('\nSessions\n');
                if (!sessions.length) {
                    console.log('  No sessions found.\n');
                    return;
                }
                for (const session of sessions as Array<Record<string, unknown>>) {
                    console.log(`  ${String(session.sessionId ?? '-')}`);
                    console.log(`    ${String(session.summary ?? '-')}`);
                    console.log(`    Workstream: ${String(session.branch ?? '-')}`);
                    console.log(`    Agent: ${String(session.agent ?? '-')}`);
                    console.log(`    Turns: ${String(session.turnCount ?? 0)}`);
                    console.log(`    Last: ${session.lastTurnAt ? new Date(Number(session.lastTurnAt)).toLocaleString() : '-'}`);
                    console.log('');
                }
            });
        } catch (error) {
            console.error('Failed to inspect sessions:', error instanceof Error ? error.message : String(error));
            return 1;
        }
    }

    async function commandAgentContext(flags: FlagMap): Promise<number> {
        const contextId = await ctx.requireCommandContextId(flags, '0ctx agent-context');
        if (!contextId) return 1;
        const asJson = Boolean(flags.json);
        const scope = ctx.resolveCommandWorkstreamScope(flags);
        const sessionLimit = ctx.parsePositiveIntegerFlag(flags['session-limit'] ?? flags.sessionLimit, 3);
        const checkpointLimit = ctx.parsePositiveIntegerFlag(flags['checkpoint-limit'] ?? flags.checkpointLimit, 2);
        const handoffLimit = ctx.parsePositiveIntegerFlag(flags['handoff-limit'] ?? flags.handoffLimit, 5);

        try {
            const result = await sendToDaemon('getAgentContextPack', {
                contextId,
                branch: scope.branch,
                worktreePath: scope.worktreePath,
                sessionLimit,
                checkpointLimit,
                handoffLimit
            }) as { promptText?: string | null };
            return ctx.printJsonOrValue(asJson, result, () => {
                if (typeof result.promptText === 'string' && result.promptText.trim().length > 0) {
                    process.stdout.write(result.promptText.endsWith('\n') ? result.promptText : `${result.promptText}\n`);
                    return;
                }
                console.log('\nAgent context is not available for the current workstream yet.\n');
            });
        } catch (error) {
            console.error('Failed to get agent context:', error instanceof Error ? error.message : String(error));
            return 1;
        }
    }

    return { commandSessions, commandAgentContext };
}
