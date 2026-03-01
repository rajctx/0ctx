import { getStore } from '@/lib/store';
import { requireTenantSession, errorResponse, jsonResponse } from '@/lib/bff';

export interface ActivityItem {
  id: string;
  ts: number;
  machineId: string;
  category: 'command' | 'event' | 'heartbeat';
  type: string;
  message: string;
  status?: string;
  accentColor: string;
}

const ACCENT: Record<string, string> = {
  command_pending:  'var(--l-gray)',
  command_applied:  '#00ff41',
  command_failed:   '#ff3333',
  event:            '#888888',
  heartbeat:        '#00ff41',
};

export async function GET(request: Request) {
  const [, claims, authErr] = await requireTenantSession();
  if (authErr) return authErr;

  const tenantId = claims.tenantId;
  if (!tenantId) {
    return errorResponse(403, 'no_tenant', 'No tenant associated with this account.');
  }

  const url = new URL(request.url);
  const limit = Math.min(200, Number(url.searchParams.get('limit') || '100'));

  try {
    const store = getStore();
    const connectors = await store.getConnectorsByTenant(tenantId);

    // Commands from all connectors
    const commandQueues = await Promise.all(
      connectors.map(c => store.getQueue(c.machineId, tenantId, 0, 200))
    );
    const allCommands = commandQueues.flat();

    // Event batches
    const allEvents = await store.getEvents({ tenantId, limit: 100 });

    const items: ActivityItem[] = [];

    for (const cmd of allCommands) {
      items.push({
        id: cmd.commandId,
        ts: cmd.createdAt,
        machineId: cmd.machineId,
        category: 'command',
        type: `CMD_${cmd.method.toUpperCase()}`,
        message: cmd.error ?? `method=${cmd.method}`,
        status: cmd.status,
        accentColor: ACCENT[`command_${cmd.status}`] ?? ACCENT.command_pending,
      });
    }

    for (const ev of allEvents) {
      items.push({
        id: ev.id,
        ts: ev.receivedAt,
        machineId: ev.machineId,
        category: 'event',
        type: 'LOG_INGEST',
        message: `${Array.isArray(ev.events) ? ev.events.length : 0} events, cursor=${ev.cursor}`,
        accentColor: ACCENT.event,
      });
    }

    // Heartbeat-like entries from connector lastHeartbeatAt
    for (const c of connectors) {
      if (c.lastHeartbeatAt) {
        items.push({
          id: `hb-${c.machineId}`,
          ts: c.lastHeartbeatAt,
          machineId: c.machineId,
          category: 'heartbeat',
          type: 'HEARTBEAT',
          message: `posture=${c.posture ?? 'unknown'}`,
          accentColor: ACCENT.heartbeat,
        });
      }
    }

    items.sort((a, b) => b.ts - a.ts);

    return jsonResponse({ items: items.slice(0, limit) });
  } catch (err) {
    console.error('[logs/activity]', err);
    return errorResponse(500, 'store_error', 'Failed to fetch activity.', true);
  }
}
