export interface MethodMetric {
    total: number;
    success: number;
    error: number;
    averageMs: number;
    p95Ms: number;
}

export interface MetricsSnapshot {
    startedAt: number;
    uptimeMs: number;
    totalRequests: number;
    methods: Record<string, MethodMetric>;
}

interface LatencyBucket {
    values: number[];
    totalDurationMs: number;
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
}

export class RequestMetrics {
    private readonly startedAt = Date.now();
    private readonly perMethod = new Map<string, { total: number; success: number; error: number; latency: LatencyBucket }>();

    record(method: string, success: boolean, durationMs: number): void {
        const metric = this.perMethod.get(method) ?? {
            total: 0,
            success: 0,
            error: 0,
            latency: { values: [], totalDurationMs: 0 }
        };

        metric.total += 1;
        if (success) metric.success += 1;
        else metric.error += 1;

        metric.latency.values.push(durationMs);
        metric.latency.totalDurationMs += durationMs;
        if (metric.latency.values.length > 1000) {
            metric.latency.values.shift();
        }

        this.perMethod.set(method, metric);
    }

    snapshot(): MetricsSnapshot {
        const methods: Record<string, MethodMetric> = {};
        let totalRequests = 0;

        for (const [method, metric] of this.perMethod.entries()) {
            totalRequests += metric.total;
            methods[method] = {
                total: metric.total,
                success: metric.success,
                error: metric.error,
                averageMs: metric.total === 0 ? 0 : Number((metric.latency.totalDurationMs / metric.total).toFixed(2)),
                p95Ms: Number(percentile(metric.latency.values, 95).toFixed(2))
            };
        }

        return {
            startedAt: this.startedAt,
            uptimeMs: Date.now() - this.startedAt,
            totalRequests,
            methods
        };
    }
}
