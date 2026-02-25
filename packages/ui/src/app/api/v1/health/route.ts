/**
 * OPS-001: GET /api/v1/health — BFF health check.
 *
 * CLOUD-002: Now reports in-process store status instead of pinging separate control-plane.
 * No auth required — health endpoints are used by load balancers and monitors.
 */
import { NextResponse } from 'next/server';
import { getStore, MemoryStore } from '@/lib/store';

const startedAt = Date.now();

export async function GET() {
    const uptimeMs = Date.now() - startedAt;
    const store = getStore();

    // In-process store is always reachable
    const storeStatus = store instanceof MemoryStore
        ? { backend: 'memory', connectors: store.connectorCount, pendingCommands: store.pendingCommandCount }
        : { backend: 'postgres' };

    return NextResponse.json({
        status: 'ok',
        uptimeMs,
        node: process.version,
        store: storeStatus
    });
}
