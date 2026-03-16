import type { DesktopEventMessage } from '../../shared/types/domain';
import { DaemonClient } from '../daemon/ipc-client';

export class DesktopEventsService {
  private subscriptionId: string | null = null;
  private lastSequence = 0;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private activeContextId: string | null = null;

  constructor(
    private readonly daemon: DaemonClient,
    private readonly publish: (event: DesktopEventMessage) => void
  ) {}

  async start(contextId?: string | null) {
    this.activeContextId = contextId ?? null;
    await this.stop();
    const payload = this.activeContextId ? { contextId: this.activeContextId } : {};
    const result = await this.daemon.call<{ subscriptionId?: string; lastAckedSequence?: number }>('subscribeEvents', payload);
    this.subscriptionId = typeof result.subscriptionId === 'string' ? result.subscriptionId : null;
    this.lastSequence = typeof result.lastAckedSequence === 'number' ? result.lastAckedSequence : 0;
    this.timer = setInterval(() => {
      void this.poll();
    }, 2_500);
    return {
      subscriptionId: this.subscriptionId
    };
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.subscriptionId) {
      await this.daemon.call('unsubscribeEvents', { subscriptionId: this.subscriptionId }).catch(() => undefined);
    }
    this.subscriptionId = null;
    this.lastSequence = 0;
  }

  dispose() {
    void this.stop();
  }

  private async poll() {
    if (!this.subscriptionId || this.inFlight) {
      return;
    }

    this.inFlight = true;
    try {
      const result = await this.daemon.call<{ cursor?: number; events?: unknown[] }>('pollEvents', {
        subscriptionId: this.subscriptionId,
        afterSequence: this.lastSequence,
        limit: 100
      });
      const nextCursor = typeof result.cursor === 'number' ? result.cursor : this.lastSequence;
      if (nextCursor > this.lastSequence && this.subscriptionId) {
        this.lastSequence = nextCursor;
        await this.daemon.call('ackEvent', {
          subscriptionId: this.subscriptionId,
          sequence: nextCursor
        }).catch(() => undefined);
      }

      for (const event of Array.isArray(result.events) ? result.events : []) {
        this.publish({
          kind: 'daemon-event',
          payload: typeof event === 'object' && event !== null ? (event as Record<string, unknown>) : {}
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Subscription') || message.includes('No event subscription')) {
        await this.start(this.activeContextId).catch(() => undefined);
      }
    } finally {
      this.inFlight = false;
    }
  }
}
