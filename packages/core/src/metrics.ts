/**
 * OPS-001: Lightweight in-process metrics collection.
 *
 * Provides counters, gauges, and histograms with Prometheus-compatible text output.
 * No external dependency — suitable for embedding in local runtimes and support services.
 *
 * Usage:
 *   import { metrics } from '@0ctx/core/metrics';
 *   metrics.counter('http_requests_total', { method: 'GET', status: '200' });
 *   metrics.gauge('connections_active', 5);
 *   metrics.histogram('request_duration_ms', 42);
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type Labels = Record<string, string>;

interface CounterEntry {
    value: number;
}

interface GaugeEntry {
    value: number;
}

interface HistogramEntry {
    count: number;
    sum: number;
    buckets: Map<number, number>; // upper bound → cumulative count
}

const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

// ── Storage ───────────────────────────────────────────────────────────────────

const counters = new Map<string, CounterEntry>();
const gauges = new Map<string, GaugeEntry>();
const histograms = new Map<string, HistogramEntry>();

function labelsKey(name: string, labels?: Labels): string {
    if (!labels || Object.keys(labels).length === 0) return name;
    const sorted = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
    return `${name}{${sorted.map(([k, v]) => `${k}="${v}"`).join(',')}}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export const metrics = {
    /** Increment a counter by 1 (or more). */
    counter(name: string, labels?: Labels, inc = 1): void {
        const key = labelsKey(name, labels);
        const entry = counters.get(key) ?? { value: 0 };
        entry.value += inc;
        counters.set(key, entry);
    },

    /** Set a gauge to an absolute value. */
    gauge(name: string, value: number, labels?: Labels): void {
        const key = labelsKey(name, labels);
        gauges.set(key, { value });
    },

    /** Record a histogram observation. */
    histogram(name: string, value: number, labels?: Labels, buckets = DEFAULT_BUCKETS): void {
        const key = labelsKey(name, labels);
        let entry = histograms.get(key);
        if (!entry) {
            entry = { count: 0, sum: 0, buckets: new Map(buckets.map(b => [b, 0])) };
            histograms.set(key, entry);
        }
        entry.count++;
        entry.sum += value;
        for (const [bound] of entry.buckets) {
            if (value <= bound) {
                entry.buckets.set(bound, (entry.buckets.get(bound) ?? 0) + 1);
            }
        }
    },

    /** Reset all metrics. */
    reset(): void {
        counters.clear();
        gauges.clear();
        histograms.clear();
    },

    /** Export all metrics as a JSON snapshot. */
    snapshot(): MetricsSnapshot {
        const result: MetricsSnapshot = { counters: {}, gauges: {}, histograms: {} };
        for (const [key, entry] of counters) result.counters[key] = entry.value;
        for (const [key, entry] of gauges) result.gauges[key] = entry.value;
        for (const [key, entry] of histograms) {
            result.histograms[key] = {
                count: entry.count,
                sum: entry.sum,
                buckets: Object.fromEntries(entry.buckets)
            };
        }
        return result;
    },

    /** Export all metrics in Prometheus text exposition format. */
    toPrometheus(): string {
        const lines: string[] = [];

        for (const [key, entry] of counters) {
            lines.push(`# TYPE ${key.split('{')[0]} counter`);
            lines.push(`${key} ${entry.value}`);
        }
        for (const [key, entry] of gauges) {
            lines.push(`# TYPE ${key.split('{')[0]} gauge`);
            lines.push(`${key} ${entry.value}`);
        }
        for (const [key, entry] of histograms) {
            const baseName = key.split('{')[0];
            lines.push(`# TYPE ${baseName} histogram`);
            for (const [bound, count] of entry.buckets) {
                lines.push(`${baseName}_bucket{le="${bound}"} ${count}`);
            }
            lines.push(`${baseName}_bucket{le="+Inf"} ${entry.count}`);
            lines.push(`${baseName}_sum ${entry.sum}`);
            lines.push(`${baseName}_count ${entry.count}`);
        }

        return lines.join('\n') + '\n';
    }
};

export interface MetricsSnapshot {
    counters: Record<string, number>;
    gauges: Record<string, number>;
    histograms: Record<string, { count: number; sum: number; buckets: Record<string, number> }>;
}
