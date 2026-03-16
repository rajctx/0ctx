import type { AuditMetadata, Graph } from '@0ctx/core';
import type { EventRuntime } from '../events';
import type { MetricsSnapshot } from '../metrics';
import type { DaemonRequest } from '../protocol';
import type { SyncEngine } from '../sync-engine';

export type RequestParams = Record<string, unknown>;

export interface HandlerRuntimeContext {
    startedAt: number;
    getMetricsSnapshot?: () => MetricsSnapshot;
    syncEngine?: SyncEngine;
    eventRuntime?: EventRuntime;
    requestShutdown?: () => void;
}

export interface HandlerMethodContext {
    graph: Graph;
    connectionId: string;
    req: DaemonRequest;
    params: RequestParams;
    runtime: HandlerRuntimeContext;
    sessionContextId: string | null;
    contextId: string | null;
    auditMetadata: AuditMetadata;
}

export type MethodDispatchResult =
    | { handled: false }
    | { handled: true; result: unknown };

export const NOT_HANDLED: MethodDispatchResult = { handled: false };

export function handled(result: unknown): MethodDispatchResult {
    return { handled: true, result };
}
