import type { FlagMap, RecallCommandDeps } from './types';

export function createRecallFeedbackCommand(deps: RecallCommandDeps) {
    return async function commandRecallFeedback(flags: FlagMap, positionalArgs: string[] = []): Promise<number> {
        const action = (positionalArgs[1] ?? '').toLowerCase();
        const asJson = Boolean(flags.json);
        const contextId = deps.getContextIdFlag(flags);
        const nodeIdFilter = deps.parseOptionalStringFlag(flags['node-id'] ?? flags.nodeId);
        const helpfulFlag = Boolean(flags.helpful);
        const notHelpfulFlag = Boolean(flags['not-helpful']);

        if (action === 'list' || action === 'ls' || action === 'stats' || Boolean(flags.list) || Boolean(flags.stats)) {
            if (helpfulFlag && notHelpfulFlag) {
                console.error("Use only one feedback filter: '--helpful' or '--not-helpful'.");
                return 1;
            }

            const helpfulFilter = helpfulFlag ? true : (notHelpfulFlag ? false : undefined);
            const limit = deps.parsePositiveIntegerFlag(flags.limit, 50);
            const check = await deps.checkDaemonCapabilities(['listRecallFeedback']);
            if (!check.ok) {
                deps.printCapabilityMismatch('recall_feedback_list', check);
                return 1;
            }

            try {
                const result = await deps.sendToDaemon('listRecallFeedback', {
                    contextId,
                    limit,
                    nodeId: nodeIdFilter,
                    helpful: helpfulFilter
                }) as {
                    contextId?: string | null;
                    total?: number;
                    helpfulCount?: number;
                    notHelpfulCount?: number;
                    nodeSummary?: Array<{ nodeId: string; helpful: number; notHelpful: number; netScore: number; lastFeedbackAt: number }>;
                    items?: Array<{ nodeId: string; helpful: boolean; reason?: string | null; createdAt?: number }>;
                };

                if (asJson) {
                    console.log(JSON.stringify(result, null, 2));
                    return 0;
                }

                const statsOnly = action === 'stats' || Boolean(flags.stats);
                console.log('\nRecall Feedback List\n');
                console.log(`  context_id:    ${String(result.contextId ?? contextId ?? 'active/global')}`);
                console.log(`  total:         ${result.total ?? 0}`);
                console.log(`  helpful:       ${result.helpfulCount ?? 0}`);
                console.log(`  not_helpful:   ${result.notHelpfulCount ?? 0}`);
                if (!statsOnly && Array.isArray(result.items) && result.items.length > 0) {
                    console.log('\n  recent_feedback:');
                    for (const item of result.items.slice(0, 10)) {
                        const ts = typeof item.createdAt === 'number' ? new Date(item.createdAt).toISOString() : 'n/a';
                        console.log(`    node=${item.nodeId} helpful=${item.helpful} at=${ts}`);
                    }
                }
                if (Array.isArray(result.nodeSummary) && result.nodeSummary.length > 0) {
                    console.log('\n  top_nodes:');
                    for (const node of result.nodeSummary.slice(0, 10)) {
                        const ts = typeof node.lastFeedbackAt === 'number' ? new Date(node.lastFeedbackAt).toISOString() : 'n/a';
                        console.log(`    node=${node.nodeId} net=${node.netScore} helpful=${node.helpful} not_helpful=${node.notHelpful} last=${ts}`);
                    }
                }
                console.log('');
                return 0;
            } catch (error) {
                console.error('recall_feedback_list_failed:', error instanceof Error ? error.message : String(error));
                return 1;
            }
        }

        if (!nodeIdFilter) {
            console.error("Missing required '--node-id' for recall feedback.");
            return 1;
        }
        if (helpfulFlag === notHelpfulFlag) {
            console.error("Provide exactly one of '--helpful' or '--not-helpful' for recall feedback.");
            return 1;
        }

        const reason = deps.parseOptionalStringFlag(flags.reason);
        const helpful = helpfulFlag && !notHelpfulFlag;
        const check = await deps.checkDaemonCapabilities(['recallFeedback']);
        if (!check.ok) {
            deps.printCapabilityMismatch('recall_feedback', check);
            return 1;
        }

        try {
            const result = await deps.sendToDaemon('recallFeedback', { contextId, nodeId: nodeIdFilter, helpful, reason }) as Record<string, unknown>;
            if (asJson) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log('\nRecall Feedback\n');
                console.log(`  node_id:      ${String(result.nodeId ?? nodeIdFilter)}`);
                console.log(`  helpful:      ${String(result.helpful ?? helpful)}`);
                if (reason) console.log(`  reason:       ${reason}`);
                if (contextId) console.log(`  context_id:   ${contextId}`);
                console.log(`  recorded_at:  ${typeof result.recordedAt === 'number' ? new Date(result.recordedAt).toISOString() : 'n/a'}`);
                console.log('');
            }
            return 0;
        } catch (error) {
            console.error('recall_feedback_failed:', error instanceof Error ? error.message : String(error));
            return 1;
        }
    };
}
