/**
 * OPS-001: GET /api/v1/metrics — Prometheus-compatible metrics endpoint.
 *
 * Returns BFF-side metrics in Prometheus text exposition format.
 * No auth required — metrics endpoints are typically open for scraping.
 *
 * NOTE: The hosted UI does not bundle @0ctx/core. Metrics are reported
 * from in-process counters instead.
 */
import { NextResponse } from 'next/server';

const startedAt = Date.now();

export async function GET() {
    const uptimeMs = Date.now() - startedAt;
    const lines = [
        '# HELP ctx_bff_uptime_ms BFF process uptime in milliseconds',
        '# TYPE ctx_bff_uptime_ms gauge',
        `ctx_bff_uptime_ms ${uptimeMs}`,
        ''
    ].join('\n');

    return new NextResponse(lines, {
        status: 200,
        headers: {
            'Content-Type': 'text/plain; version=0.0.4; charset=utf-8'
        }
    });
}
