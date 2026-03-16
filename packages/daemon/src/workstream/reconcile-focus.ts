function formatFocusSample(items: string[], prefix: string): string | null {
    if (items.length === 0) return null;
    const sample = items.slice(0, 3).join(', ');
    const suffix = items.length > 3 ? ` (+${items.length - 3} more)` : '';
    return `${prefix} ${sample}${suffix}.`;
}

export function buildReconcileFocusSteps(options: {
    sharedConflictLikelyFiles: string[];
    sharedChangedAreas: string[];
}): string[] {
    const steps = [
        formatFocusSample(options.sharedConflictLikelyFiles, 'Resolve likely conflicts in'),
        formatFocusSample(options.sharedChangedAreas, 'Focus review on')
    ].filter((entry): entry is string => Boolean(entry));

    return steps;
}
