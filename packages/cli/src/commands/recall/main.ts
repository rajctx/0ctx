import type { FlagMap, RecallCommandDeps } from './types';
import { createRecallFeedbackCommand } from './feedback';

export function createRecallCommand(deps: RecallCommandDeps) {
    const commandRecallFeedback = createRecallFeedbackCommand(deps);

    return async function commandRecall(flags: FlagMap, positionalArgs: string[] = []): Promise<number> {
        if ((positionalArgs[0] ?? '').toLowerCase() === 'feedback') {
            return commandRecallFeedback(flags, positionalArgs);
        }

        const modeRaw = deps.parseOptionalStringFlag(flags.mode) ?? 'auto';
        const mode = modeRaw.toLowerCase();
        const validModes = new Set(['auto', 'temporal', 'topic', 'graph']);
        if (!validModes.has(mode)) {
            console.error(`Invalid recall mode: '${modeRaw}'. Expected one of: auto, temporal, topic, graph.`);
            return 1;
        }

        const query = deps.parseOptionalStringFlag(flags.query);
        const contextId = deps.getContextIdFlag(flags);
        const sinceHours = deps.parsePositiveNumberFlag(flags['since-hours'], 24);
        const limit = deps.parsePositiveIntegerFlag(flags.limit, 10);
        const depth = deps.parsePositiveIntegerFlag(flags.depth, 2);
        const maxNodes = deps.parsePositiveIntegerFlag(flags['max-nodes'], 30);
        const startBrief = Boolean(flags.start);
        const asJson = Boolean(flags.json);
        const effectiveMode = startBrief ? 'auto' : mode;

        try {
            const check = await deps.checkDaemonCapabilities(['recall']);
            if (!check.ok) {
                deps.printCapabilityMismatch('recall', check);
                return 1;
            }

            const result = await deps.sendToDaemon('recall', {
                contextId,
                mode: effectiveMode,
                query,
                sinceHours,
                limit,
                depth,
                maxNodes
            }) as Record<string, any>;

            if (asJson) {
                console.log(JSON.stringify(result, null, 2));
                return 0;
            }

            if (startBrief) {
                console.log('\nRecall Start Brief\n');
                console.log(`  mode:          ${result.mode ?? 'auto'}`);
                console.log(`  context:       ${result.contextId ?? 'active/global'}`);
                if (query) console.log(`  query:         ${query}`);

                const sessions = Array.isArray(result.temporal?.sessions) ? result.temporal.sessions : [];
                if (sessions.length > 0) {
                    console.log('\n  recent_sessions:');
                    for (const session of sessions.slice(0, 3)) {
                        const ts = typeof session.endAt === 'number' ? new Date(session.endAt).toISOString() : 'n/a';
                        const actions = Array.isArray(session.actions) ? session.actions.slice(0, 3).join(',') : 'n/a';
                        console.log(`    at=${ts} actions=${actions}`);
                    }
                }

                const recommendations = Array.isArray(result.recommendations) ? result.recommendations : [];
                const topicHits = Array.isArray(result.topic?.hits) ? result.topic.hits : [];
                const anchors = recommendations.length > 0 ? recommendations : topicHits.slice(0, 3).map((hit: any) => ({
                    nodeId: hit.nodeId,
                    score: hit.score,
                    reason: hit.matchReason
                }));
                if (anchors.length > 0) {
                    console.log('\n  anchors:');
                    for (const anchor of anchors.slice(0, 3)) {
                        console.log(`    node=${anchor.nodeId ?? 'n/a'} score=${anchor.score ?? 'n/a'} reason=${anchor.reason ?? 'n/a'}`);
                    }
                }

                console.log(`\n  graph_nodes:   ${result.graph?.subgraph?.nodes?.length ?? 0}`);
                console.log('\n  next_steps:');
                console.log(query ? `    1) 0ctx recall --mode=graph --query="${query}" --json` : '    1) 0ctx recall --mode=topic --query="<your topic>" --json');
                console.log('    2) 0ctx logs');
                console.log('');
                return 0;
            }

            console.log('\nRecall Summary\n');
            console.log(`  mode:          ${result.mode ?? effectiveMode}`);
            console.log(`  context:       ${result.contextId ?? 'active/global'}`);
            if (query) console.log(`  query:         ${query}`);

            const summary = result.summary as Record<string, unknown> | undefined;
            if (summary) {
                console.log(`  sessions:      ${summary.sessionCount ?? 0}`);
                console.log(`  recent_events: ${summary.recentEventCount ?? 0}`);
                console.log(`  topic_hits:    ${summary.topicHitCount ?? 0}`);
                console.log(`  graph_nodes:   ${summary.graphNodeCount ?? 0}`);
            }
            if (Array.isArray(result.recommendations) && result.recommendations.length > 0) {
                console.log('\n  recommendations:');
                for (const item of result.recommendations.slice(0, 5)) {
                    console.log(`    node=${item.nodeId ?? 'n/a'} score=${item.score ?? 'n/a'} reason=${item.reason ?? 'n/a'}`);
                }
            }
            if (result.mode === 'topic' && Array.isArray(result.hits)) {
                console.log('\n  top_hits:');
                for (const hit of result.hits.slice(0, 5)) {
                    const preview = typeof hit.content === 'string' ? hit.content.slice(0, 96) : '';
                    console.log(`    score=${hit.score ?? 'n/a'} reason=${hit.matchReason ?? 'n/a'} ${preview}`);
                }
            }
            console.log('');
            return 0;
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            if (text.includes('Unknown method: recall')) {
                deps.printCapabilityMismatch('recall', {
                    ok: false,
                    reachable: true,
                    apiVersion: null,
                    methods: [],
                    missingMethods: ['recall'],
                    error: text,
                    recoverySteps: ['0ctx daemon start', '0ctx daemon service restart']
                });
                return 1;
            }
            console.error('recall_failed:', text);
            return 1;
        }
    };
}
