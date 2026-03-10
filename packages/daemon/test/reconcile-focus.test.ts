import { describe, expect, it } from 'vitest';
import { deriveReconcileSteps } from '../src/workstream/reconcile';

describe('reconcile focus guidance', () => {
    it('includes both likely-conflict files and hotspot areas in manual reconcile steps', () => {
        const steps = deriveReconcileSteps({
            sameRepository: true,
            comparable: true,
            comparisonReadiness: 'review',
            comparisonActionHint: null,
            reconcileStrategy: 'manual_conflict_resolution',
            sourceLabel: 'main',
            targetLabel: 'feature/conflicts',
            comparisonBlockers: [],
            comparisonReviewItems: [],
            sharedConflictLikelyFiles: ['packages/core/shared.ts', 'shared.txt'],
            sharedChangedAreas: ['packages/core', 'shared.txt']
        });

        expect(steps).toContain('Review the shared changed files before choosing merge or rebase.');
        expect(steps.some((step) => step.includes('Resolve likely conflicts in packages/core/shared.ts, shared.txt.'))).toBe(true);
        expect(steps.some((step) => step.includes('Focus review on packages/core, shared.txt.'))).toBe(true);
        expect(steps).toContain('Resolve conflicts manually and verify the resulting branch state.');
    });

    it('uses hotspot guidance during rebase when no direct conflict-file sample exists', () => {
        const steps = deriveReconcileSteps({
            sameRepository: true,
            comparable: true,
            comparisonReadiness: 'review',
            comparisonActionHint: null,
            reconcileStrategy: 'rebase_target_on_source',
            sourceLabel: 'main',
            targetLabel: 'feature/hotspot',
            comparisonBlockers: [],
            comparisonReviewItems: [],
            sharedConflictLikelyFiles: [],
            sharedChangedAreas: ['packages/daemon', 'packages/core']
        });

        expect(steps).toContain('Open feature/hotspot.');
        expect(steps).toContain('Rebase it onto main.');
        expect(steps.some((step) => step.includes('Focus review on packages/daemon, packages/core.'))).toBe(true);
        expect(steps).toContain('Create a checkpoint before handing the workstream to another agent.');
    });
});
