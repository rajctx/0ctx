import { describe, expect, it } from 'vitest';
import { getBestShellSuggestion, getShellCompletionCandidates } from '../src/shell/ui';

describe('shell UI helpers', () => {
    it('includes slash-prefixed variants for normal commands', () => {
        const candidates = getShellCompletionCandidates();
        expect(candidates).toContain('auth login');
        expect(candidates).toContain('/auth login');
        expect(candidates).toContain('/help');
    });

    it('returns the first matching completion as a suggestion', () => {
        const candidates = getShellCompletionCandidates();
        expect(getBestShellSuggestion('auth', candidates)).toBe('auth login');
        expect(getBestShellSuggestion('auth login', candidates)).toBe('');
        expect(getBestShellSuggestion('', candidates)).toBe('');
    });
});
