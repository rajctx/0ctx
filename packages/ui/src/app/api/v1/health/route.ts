/**
 * OPS-001: GET /api/v1/health — BFF health check.
 *
 * Reports BFF status and optionally pings the control-plane.
 * No auth required — health endpoints are used by load balancers and monitors.
 */
import { NextResponse } from 'next/server';

const CONTROL_PLANE_URL =
    process.env.CTX_CONTROL_PLANE_URL || 'http://127.0.0.1:8787';
const startedAt = Date.now();

export async function GET() {
    const uptimeMs = Date.now() - startedAt;

    // Best-effort control-plane ping
    let controlPlane: { status: string; latencyMs?: number } = { status: 'unknown' };
    try {
        const t0 = Date.now();
        const cpRes = await fetch(`${CONTROL_PLANE_URL}/v1/health`, {
            signal: AbortSignal.timeout(3000)
        });
        const latencyMs = Date.now() - t0;
        controlPlane = cpRes.ok
            ? { status: 'ok', latencyMs }
            : { status: 'degraded', latencyMs };
    } catch {
        controlPlane = { status: 'unreachable' };
    }

    const overall = controlPlane.status === 'ok' ? 'ok' : 'degraded';

    return NextResponse.json({
        status: overall,
        uptimeMs,
        node: process.version,
        controlPlane
    });
}
