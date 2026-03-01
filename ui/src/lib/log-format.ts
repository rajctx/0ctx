/**
 * Shared formatting helpers for the /dashboard/logs/* pages.
 * Centralises fmtAgo / fmtTs / fmtTsISO / fmtBytes / fmtUptime so that
 * each page file doesn't have to redefine them.
 */

/**
 * Returns a human-readable "time ago" string for a unix-ms timestamp.
 * @param ms         Unix milliseconds (or null/0 for no value)
 * @param nullLabel  What to return when ms is falsy (default '--')
 */
export function fmtAgo(ms: number | null | undefined, nullLabel = '--'): string {
  if (!ms) return nullLabel;
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5)     return 'just now';
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * Formats a unix-ms timestamp as a millisecond-precision time string.
 * Good for live activity / event streams where the date is implied.
 * e.g. "14:23:45.123"
 */
export function fmtTs(ms: number | null | undefined): string {
  if (!ms) return '--';
  const d = new Date(ms);
  return (
    d.toLocaleTimeString('en-US', { hour12: false }) +
    '.' +
    String(d.getMilliseconds()).padStart(3, '0')
  );
}

/**
 * Formats a unix-ms timestamp as an ISO-like date-time string.
 * Good for stored records where the full date matters.
 * e.g. "2024-03-01 14:23:45Z"
 */
export function fmtTsISO(ms: number | null | undefined): string {
  if (!ms) return '--';
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Returns a human-readable byte size string.
 * e.g. 1500 → "1.5 KB", 2000000 → "1.91 MB"
 */
export function fmtBytes(n: number): string {
  if (n < 1024)    return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

/**
 * Formats a millisecond uptime as "Xh Ym" / "Xm Ys" / "Xs".
 */
export function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}
