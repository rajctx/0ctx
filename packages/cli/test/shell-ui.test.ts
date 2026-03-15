import { describe, expect, it } from 'vitest';
import { getBestShellSuggestion, getShellCompletionCandidates } from '../src/shell/ui';

describe('shell UI helpers', () => {
    it('includes slash-prefixed variants for normal commands', () => {
        const candidates = getShellCompletionCandidates();
        expect(candidates).toContain('status');
        expect(candidates).toContain('/status');
        expect(candidates).toContain('/help');
    });

    it('returns the first matching completion as a suggestion', () => {
        const candidates = getShellCompletionCandidates();
        expect(getBestShellSuggestion('sta', candidates)).toBe('status');
        expect(getBestShellSuggestion('status', candidates)).toBe('status --json');
        expect(getBestShellSuggestion('', candidates)).toBe('');
    });
});
