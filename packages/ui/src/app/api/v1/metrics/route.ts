/**
 * OPS-001: GET /api/v1/metrics — Prometheus-compatible metrics endpoint.
 *
 * Returns BFF-side metrics in Prometheus text exposition format.
 * No auth required — metrics endpoints are typically open for scraping.
 */
import { NextResponse } from 'next/server';
import { metrics } from '@0ctx/core/metrics';

export async function GET() {
    const body = metrics.toPrometheus();
    return new NextResponse(body, {
        status: 200,
        headers: {
            'Content-Type': 'text/plain; version=0.0.4; charset=utf-8'
        }
    });
}
