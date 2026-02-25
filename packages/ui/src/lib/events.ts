/**
 * CLOUD-002: Event processing pipeline.
 *
 * Provides in-process event fan-out via EventEmitter when events are ingested.
 * Also exports a helper for creating SSE streams.
 */

import { EventEmitter } from 'events';
import type { EventIngest } from '@/lib/store';

// ── Global event bus ─────────────────────────────────────────────────────────

const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

export type EventHandler = (entry: EventIngest) => void;

/** Subscribe to all ingested events. Returns an unsubscribe function. */
export function onEvent(handler: EventHandler): () => void {
  eventBus.on('ingest', handler);
  return () => eventBus.off('ingest', handler);
}

/** Emit an ingested event to all subscribers. Called after store write. */
export function emitEvent(entry: EventIngest): void {
  eventBus.emit('ingest', entry);
}

// ── SSE helpers ──────────────────────────────────────────────────────────────

/**
 * Create an SSE ReadableStream that pushes events as they arrive.
 * Keeps the connection open with periodic keepalive pings.
 */
export function createEventStream(filter?: { machineId?: string; tenantId?: string }): ReadableStream {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (data: string, event = 'message') => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      };

      // Send initial connection event
      send(JSON.stringify({ connected: true, ts: Date.now() }), 'connected');

      // Subscribe to events
      const unsub = onEvent((entry) => {
        if (filter?.machineId && entry.machineId !== filter.machineId) return;
        if (filter?.tenantId && entry.tenantId !== filter.tenantId) return;
        send(JSON.stringify(entry));
      });

      // Keepalive every 15s
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          // Stream closed
          clearInterval(keepalive);
        }
      }, 15_000);

      // Cleanup on cancel
      const originalCancel = controller.close.bind(controller);
      controller.close = () => {
        unsub();
        clearInterval(keepalive);
        originalCancel();
      };
    }
  });
}
