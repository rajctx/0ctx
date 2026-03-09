export function parsePositiveInt(value: unknown, fallback: number, max = 500): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(1, Math.min(max, Math.floor(value)));
}

export function truncateBriefLine(value: string, max = 88): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function humanizeLabel(value: string): string {
    return String(value ?? '')
        .trim()
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatRelativeAge(timestamp: number, now = Date.now()): string {
    const delta = Math.max(0, now - timestamp);
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (delta < minute) return 'just now';
    if (delta < hour) return `${Math.max(1, Math.floor(delta / minute))}m ago`;
    if (delta < day) return `${Math.max(1, Math.floor(delta / hour))}h ago`;
    return `${Math.max(1, Math.floor(delta / day))}d ago`;
}
