import { describe, expect, it } from 'vitest';
import { renderExtractionResultLines } from '../src/commands/workstream/insights-display';

describe('insight preview display', () => {
    it('renders trust and review signals for preview candidates', () => {
        const lines = renderExtractionResultLines(
            '\nSession Insights Preview\n',
            '  Session: session-1',
            {
                candidateCount: 1,
                createCount: 1,
                reuseCount: 0,
                summary: {
                    strongCount: 1,
                    reviewCount: 0,
                    weakCount: 0,
                    autoPersistCount: 1,
                    reviewOnlyCount: 0,
                    readyPromotionCount: 1,
                    reviewPromotionCount: 0,
                    blockedPromotionCount: 0
                },
                candidates: [
                    {
                        type: 'decision',
                        action: 'create',
                        content: 'Daemon must remain the source of truth for context state.',
                        confidence: 0.91,
                        reviewTier: 'strong',
                        autoPersist: true,
                        trustFlags: ['cross_session', 'cross_role'],
                        distinctSessionCount: 2,
                        evidenceSummary: 'Repeated 3 times across 2 sessions.',
                        reviewSummary: 'Strong signal corroborated across sessions and roles.',
                        trustSummary: 'Strong signal corroborated across sessions and roles. Repeated 3 times across 2 sessions.',
                        promotionState: 'ready',
                        promotionSummary: 'Ready to promote: corroborated across 2 sessions with enough evidence to move across workspaces.',
                        autoPersistSummary: 'Auto-persistable. Evidence is strong enough for checkpoint-time writing.',
                        reason: 'decision-language, repeated-3-times, corroborated-across-roles'
                    }
                ]
            }
        );

        const rendered = lines.join('\n');
        expect(rendered).toContain('Trust: 1 strong, 0 review, 0 weak');
        expect(rendered).toContain('Write: 1 auto, 0 review-only');
        expect(rendered).toContain('Promote: 1 ready, 0 review, 0 blocked');
        expect(rendered).toContain('[decision | CREATE | Strong | PROMOTE Ready | AUTO WRITE]');
        expect(rendered).toContain('confidence: 91% confidence');
        expect(rendered).toContain('trust flags: Cross Session, Cross Role');
        expect(rendered).toContain('sessions: 2');
        expect(rendered).toContain('evidence: Repeated 3 times across 2 sessions.');
        expect(rendered).toContain('trust: Strong signal corroborated across sessions and roles. Repeated 3 times across 2 sessions.');
        expect(rendered).toContain('review note: Strong signal corroborated across sessions and roles.');
        expect(rendered).toContain('promote: Ready to promote: corroborated across 2 sessions with enough evidence to move across workspaces.');
        expect(rendered).toContain('write note: Auto-persistable. Evidence is strong enough for checkpoint-time writing.');
        expect(rendered).toContain('why: Decision Language, Repeated 3 Times, Corroborated Across Roles');
    });

    it('keeps saved-node output compact', () => {
        const lines = renderExtractionResultLines(
            '\nCheckpoint Insights Save\n',
            '  Checkpoint: cp-1',
            {
                nodeCount: 1,
                createdCount: 1,
                reusedCount: 0,
                nodes: [
                    {
                        type: 'constraint',
                        content: 'Do not silently blend workspaces.'
                    }
                ],
                summary: {
                    strongCount: 1,
                    reviewCount: 0,
                    weakCount: 0,
                    autoPersistCount: 1,
                    reviewOnlyCount: 0,
                    readyPromotionCount: 1,
                    reviewPromotionCount: 0,
                    blockedPromotionCount: 0
                }
            }
        );

        const rendered = lines.join('\n');
        expect(rendered).toContain('[constraint]');
        expect(rendered).not.toContain('confidence:');
        expect(rendered).not.toContain('review note:');
        expect(rendered).not.toContain('write note:');
    });
});
