const DEFAULT_INTERVAL_MS = 5_000;
const MIN_INTERVAL_MS = 1_000;

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function normalizeIntervalMs(intervalMs: number | undefined): number {
    if (!intervalMs || !Number.isFinite(intervalMs)) return DEFAULT_INTERVAL_MS;
    return Math.max(MIN_INTERVAL_MS, intervalMs);
}
