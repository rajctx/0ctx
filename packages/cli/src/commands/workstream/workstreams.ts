import { sendToDaemon } from '@0ctx/mcp/dist/client';
import type { FlagMap } from './types';
import type { WorkstreamCommandContext } from './shared';

export function createBranchCommands(ctx: WorkstreamCommandContext) {
    async function commandBranches(args: string[], flags: FlagMap): Promise<number> {
        const subcommand = String(args[0] || '').trim().toLowerCase();
        const commandLabel = subcommand === 'compare'
            ? '0ctx workstreams compare'
            : (subcommand === 'current' ? '0ctx workstreams current' : '0ctx workstreams');
        const contextId = await ctx.requireCommandContextId(flags, commandLabel);
        if (!contextId) return 1;
        const asJson = Boolean(flags.json);

        try {
            if (subcommand === 'current') {
                const scope = ctx.resolveCommandWorkstreamScope(flags);
                const sessionLimit = ctx.parsePositiveIntegerFlag(flags['session-limit'] ?? flags.sessionLimit, 3);
                const checkpointLimit = ctx.parsePositiveIntegerFlag(flags['checkpoint-limit'] ?? flags.checkpointLimit, 2);
                const result = await sendToDaemon('getWorkstreamBrief', {
                    contextId,
                    branch: scope.branch,
                    worktreePath: scope.worktreePath,
                    sessionLimit,
                    checkpointLimit
                }) as Record<string, any>;

                return ctx.printJsonOrValue(asJson, result, () => {
                    const workstreamName = result.branch
                        || (result.isDetachedHead && result.currentHeadSha ? `detached HEAD @ ${String(result.currentHeadSha).slice(0, 12)}` : 'unknown workstream');
                    const workstreamLabel = `${workstreamName}${result.worktreePath ? ` (${result.worktreePath})` : ''}`;
                    console.log('\nCurrent Workstream\n');
                    console.log(`  Workspace: ${result.workspaceName}`);
                    console.log(`  Workstream: ${workstreamLabel}`);
                    console.log(`  Sessions: ${result.sessionCount} | Checkpoints: ${result.checkpointCount}`);
                    if (result.lastActivityAt) console.log(`  Last activity: ${new Date(result.lastActivityAt).toLocaleString()}`);
                    if (result.lastAgent) console.log(`  Last agent: ${result.lastAgent}`);
                    if (result.lastCommitSha) console.log(`  Last commit: ${String(result.lastCommitSha).slice(0, 12)}`);
                    if (result.stateSummary) console.log(`  Status: ${result.stateSummary}`);
                    if (result.stateActionHint) console.log(`  Next: ${result.stateActionHint}`);
                    if (Array.isArray(result.handoffBlockers) && result.handoffBlockers.length > 0) {
                        console.log(`  Blockers: ${result.handoffBlockers.join(' | ')}`);
                    }
                    if (Array.isArray(result.handoffReviewItems) && result.handoffReviewItems.length > 0) {
                        console.log(`  Review: ${result.handoffReviewItems.join(' | ')}`);
                    }
                    if (result.isDetachedHead && result.currentHeadSha) {
                        console.log(`  HEAD: detached @ ${String(result.currentHeadSha).slice(0, 12)}`);
                    } else if (result.currentHeadSha) {
                        const refLabel = result.currentHeadRef ? ` | ${result.currentHeadRef}` : '';
                        console.log(`  HEAD: ${String(result.currentHeadSha).slice(0, 12)}${refLabel}`);
                    }
                    const checkoutState = ctx.describeCheckoutStateHuman(result);
                    if (checkoutState) console.log(`  Checkout: ${checkoutState}`);
                    if (result.upstream) {
                        const ahead = typeof result.aheadCount === 'number' ? result.aheadCount : '?';
                        const behind = typeof result.behindCount === 'number' ? result.behindCount : '?';
                        console.log(`  Git: ${result.upstream} | ahead ${ahead} | behind ${behind}`);
                    } else if (result.stateKind === 'isolated') {
                        console.log('  Git: local-only workstream (no upstream or baseline)');
                    } else if (result.stateKind === 'current' && result.isCurrent === true) {
                        console.log('  Git: current local workstream');
                    }
                    if (result.mergeBaseSha) console.log(`  Merge base: ${String(result.mergeBaseSha).slice(0, 12)}`);
                    if (result.headDiffersFromCaptured && result.captureDrift?.summary) {
                        console.log(`  Capture drift: ${result.captureDrift.summary}`);
                    }
                    if (result.hasUncommittedChanges) {
                        console.log(`  Local changes: unmerged ${result.unmergedCount ?? 0} | staged ${result.stagedChangeCount ?? 0} | unstaged ${result.unstagedChangeCount ?? 0} | untracked ${result.untrackedCount ?? 0}`);
                    }
                    if (result.baseline?.summary) console.log(`  Baseline: ${result.baseline.summary}`);
                    if (Array.isArray(result.recentSessions) && result.recentSessions.length > 0) {
                        console.log('\n  Recent sessions:');
                        for (const session of result.recentSessions.slice(0, 3)) {
                            const agent = session.agent ? `[${session.agent}] ` : '';
                            console.log(`    - ${agent}${ctx.short(String(session.summary ?? '-'), 120)}`);
                        }
                    }
                    if (Array.isArray(result.latestCheckpoints) && result.latestCheckpoints.length > 0) {
                        console.log('\n  Latest checkpoints:');
                        for (const checkpoint of result.latestCheckpoints.slice(0, 3)) {
                            const label = checkpoint.name || checkpoint.summary || 'checkpoint';
                            console.log(`    - ${ctx.short(String(label), 120)}`);
                        }
                    }
                    if (Array.isArray(result.insights) && result.insights.length > 0) {
                        console.log('\n  Reviewed insights:');
                        for (const insight of result.insights.slice(0, 4)) {
                            const trust = insight.trustTier ? ` | ${insight.trustTier} trust` : '';
                            const promotion = insight.promotionState ? ` | ${insight.promotionState} promotion` : '';
                            console.log(`    - [${String(insight.type ?? 'insight')}${trust}${promotion}] ${ctx.short(String(insight.content ?? '-'), 120)}`);
                        }
                    }
                    console.log('');
                });
            }

            if (subcommand === 'compare') {
                const sourceBranch = ctx.parseOptionalStringFlag(flags.source ?? flags['source-branch'] ?? flags.sourceBranch);
                const targetBranch = ctx.parseOptionalStringFlag(flags.target ?? flags['target-branch'] ?? flags.targetBranch);
                if (!sourceBranch || !targetBranch) {
                    console.error('Missing workstream comparison inputs. Pass --source=<branch> and --target=<branch>.');
                    return 1;
                }
                const sourceWorktreePath = ctx.parseOptionalStringFlag(flags['source-worktree-path'] ?? flags.sourceWorktreePath);
                const targetWorktreePath = ctx.parseOptionalStringFlag(flags['target-worktree-path'] ?? flags.targetWorktreePath);
                const sessionLimit = ctx.parsePositiveIntegerFlag(flags['session-limit'] ?? flags.sessionLimit, 3);
                const checkpointLimit = ctx.parsePositiveIntegerFlag(flags['checkpoint-limit'] ?? flags.checkpointLimit, 2);
                const result = await sendToDaemon('compareWorkstreams', {
                    contextId,
                    sourceBranch,
                    sourceWorktreePath,
                    targetBranch,
                    targetWorktreePath,
                    sessionLimit,
                    checkpointLimit
                }) as Record<string, any>;

                return ctx.printJsonOrValue(asJson, result, () => {
                    const sourceLabel = `${result.source.branch || 'detached'}${result.source.worktreePath ? ` (${result.source.worktreePath})` : ''}`;
                    const targetLabel = `${result.target.branch || 'detached'}${result.target.worktreePath ? ` (${result.target.worktreePath})` : ''}`;
                    console.log('\nWorkstream comparison\n');
                    console.log(`  Workspace: ${result.workspaceName}`);
                    console.log(`  Source:    ${sourceLabel}`);
                    console.log(`  Target:    ${targetLabel}`);
                    console.log(`  Sessions:  ${result.source.sessionCount} vs ${result.target.sessionCount}`);
                    console.log(`  Checkpts:  ${result.source.checkpointCount} vs ${result.target.checkpointCount}`);
                    console.log(`  State:     ${result.comparisonKind}`);
                    if (result.comparisonReadiness) console.log(`  Ready:     ${result.comparisonReadiness}`);
                    console.log(`  Summary:   ${result.comparisonSummary}`);
                    if (result.source.lastCommitSha || result.target.lastCommitSha) {
                        console.log(`  Commits:   ${String(result.source.lastCommitSha || 'none').slice(0, 12)} vs ${String(result.target.lastCommitSha || 'none').slice(0, 12)}`);
                    }
                    if (result.comparable && result.sameRepository) {
                        console.log(`  Git:       source ahead ${result.sourceAheadCount ?? '?'} | target ahead ${result.targetAheadCount ?? '?'} | newer ${result.newerSide}`);
                        console.log(`  Merge base:${result.mergeBaseSha ? ` ${String(result.mergeBaseSha).slice(0, 12)}` : ' none'}`);
                    } else {
                        console.log(`  Git:       ${result.sameRepository ? 'not comparable' : 'different repositories'}`);
                    }
                    if (result.sharedAgents.length > 0) console.log(`  Shared agents: ${result.sharedAgents.join(', ')}`);
                    if (result.sourceOnlyAgents.length > 0) console.log(`  Source only:   ${result.sourceOnlyAgents.join(', ')}`);
                    if (result.targetOnlyAgents.length > 0) console.log(`  Target only:   ${result.targetOnlyAgents.join(', ')}`);
                    if (result.changeOverlapSummary) console.log(`  Overlap:   ${result.changeOverlapSummary}`);
                    if (result.lineOverlapSummary) console.log(`  Lines:     ${result.lineOverlapSummary}`);
                    if (result.changeHotspotSummary) console.log(`  Hotspots:  ${result.changeHotspotSummary}`);
                if (result.mergeRiskSummary) console.log(`  Risk:      ${result.mergeRiskSummary}`);
                if (result.reconcileStrategySummary) console.log(`  Reconcile: ${result.reconcileStrategySummary}`);
                if (Array.isArray(result.reconcileSteps) && result.reconcileSteps.length > 0) {
                    console.log('  Steps:');
                    for (const [index, step] of result.reconcileSteps.entries()) {
                        console.log(`    ${index + 1}. ${step}`);
                    }
                }
                if (Array.isArray(result.comparisonBlockers) && result.comparisonBlockers.length > 0) {
                    console.log(`  Blockers:  ${result.comparisonBlockers.join(' | ')}`);
                }
                    if (Array.isArray(result.comparisonReviewItems) && result.comparisonReviewItems.length > 0) {
                        console.log(`  Review:    ${result.comparisonReviewItems.join(' | ')}`);
                    }
                    if (typeof result.sourceChangedFileCount === 'number' || typeof result.targetChangedFileCount === 'number') {
                        console.log(`  Files:     source ${result.sourceChangedFileCount ?? '?'} | target ${result.targetChangedFileCount ?? '?'} | shared ${result.sharedChangedFileCount ?? '?'}`);
                    }
                    if (Array.isArray(result.sharedChangedFiles) && result.sharedChangedFiles.length > 0) {
                        console.log(`  Shared files: ${result.sharedChangedFiles.slice(0, 5).join(', ')}${result.sharedChangedFiles.length > 5 ? ` (+${result.sharedChangedFiles.length - 5} more)` : ''}`);
                    }
                    if (Array.isArray(result.sharedConflictLikelyFiles) && result.sharedConflictLikelyFiles.length > 0) {
                        console.log(`  Likely conflicts: ${result.sharedConflictLikelyFiles.slice(0, 5).join(', ')}${result.sharedConflictLikelyFiles.length > 5 ? ` (+${result.sharedConflictLikelyFiles.length - 5} more)` : ''}`);
                    }
                    if (Array.isArray(result.sharedChangedAreas) && result.sharedChangedAreas.length > 0) {
                        console.log(`  Focus areas: ${result.sharedChangedAreas.slice(0, 5).join(', ')}${result.sharedChangedAreas.length > 5 ? ` (+${result.sharedChangedAreas.length - 5} more)` : ''}`);
                    }
                    if (result.source.stateSummary) console.log(`  Source status: ${result.source.stateSummary}`);
                    if (result.source.handoffSummary) console.log(`  Source handoff: ${result.source.handoffSummary}`);
                    if (result.target.stateSummary) console.log(`  Target status: ${result.target.stateSummary}`);
                    if (result.target.handoffSummary) console.log(`  Target handoff: ${result.target.handoffSummary}`);
                    if (result.comparisonActionHint) console.log(`  Next:      ${result.comparisonActionHint}`);
                    console.log(`\n  ${result.comparisonText}\n`);
                });
            }

            const limit = ctx.parsePositiveIntegerFlag(flags.limit, 100);
            const result = await sendToDaemon('listBranchLanes', { contextId, limit }) as Array<Record<string, any>>;
            return ctx.printJsonOrValue(asJson, result, () => {
                console.log('\nWorkstreams\n');
                if (!result.length) {
                    console.log('  No workstreams found.\n');
                    return;
                }
                for (const lane of result) {
                    console.log(`  ${lane.branch}${lane.worktreePath ? ` (${lane.worktreePath})` : ''}`);
                    console.log(`    Last activity: ${new Date(lane.lastActivityAt).toLocaleString()}`);
                    console.log(`    Sessions: ${lane.sessionCount} | Checkpoints: ${lane.checkpointCount}`);
                    if (lane.lastAgent) console.log(`    Last agent: ${lane.lastAgent}`);
                    if (lane.lastCommitSha) console.log(`    Last commit: ${String(lane.lastCommitSha).slice(0, 12)}`);
                    if (lane.stateSummary) console.log(`    Status: ${lane.stateSummary}`);
                    if (lane.stateActionHint) console.log(`    Next: ${lane.stateActionHint}`);
                    if (Array.isArray(lane.handoffBlockers) && lane.handoffBlockers.length > 0) {
                        console.log(`    Blockers: ${lane.handoffBlockers.join(' | ')}`);
                    }
                    if (Array.isArray(lane.handoffReviewItems) && lane.handoffReviewItems.length > 0) {
                        console.log(`    Review: ${lane.handoffReviewItems.join(' | ')}`);
                    }
                    if (lane.isDetachedHead && lane.currentHeadSha) {
                        console.log(`    HEAD: detached @ ${String(lane.currentHeadSha).slice(0, 12)}`);
                    } else if (lane.currentHeadSha || lane.currentHeadRef) {
                        const headParts = [lane.currentHeadSha ? String(lane.currentHeadSha).slice(0, 12) : null, lane.currentHeadRef ?? null].filter(Boolean);
                        if (headParts.length > 0) console.log(`    HEAD: ${headParts.join(' | ')}`);
                    }
                    const checkoutState = ctx.describeCheckoutStateHuman(lane);
                    if (checkoutState) console.log(`    Checkout: ${checkoutState}`);
                    if (lane.headDiffersFromCaptured && lane.captureDrift?.summary) {
                        console.log(`    Capture drift: ${lane.captureDrift.summary}`);
                    }
                    if (lane.hasMergeConflicts) {
                        console.log(`    Conflicts: ${lane.unmergedCount ?? 0} unmerged path${lane.unmergedCount === 1 ? '' : 's'}`);
                    }
                    if (lane.baseline?.summary) console.log(`    Baseline: ${lane.baseline.summary}`);
                    if (lane.upstream) {
                        const ahead = typeof lane.aheadCount === 'number' ? lane.aheadCount : '?';
                        const behind = typeof lane.behindCount === 'number' ? lane.behindCount : '?';
                        console.log(`    Git: ${lane.upstream} | ahead ${ahead} | behind ${behind}`);
                    } else if (lane.stateKind === 'isolated') {
                        console.log('    Git: local-only workstream (no upstream or baseline)');
                    } else if (lane.stateKind === 'current' && lane.isCurrent === true) {
                        console.log('    Git: current local workstream');
                    }
                    if (Array.isArray(lane.agentSet) && lane.agentSet.length > 0) console.log(`    Agents: ${lane.agentSet.join(', ')}`);
                    console.log('');
                }
            });
        } catch (error) {
            console.error('Failed to list workstreams:', error instanceof Error ? error.message : String(error));
            return 1;
        }
    }

    return { commandBranches };
}
