import { requireSession } from '@/lib/bff';
import { createEventStream } from '@/lib/events';

export async function GET(request: Request) {
  const [, authErr] = await requireSession();
  if (authErr) return authErr;

  const url = new URL(request.url);
  const machineId = url.searchParams.get('machineId') ?? undefined;
  const tenantId = url.searchParams.get('tenantId') ?? undefined;

  const stream = createEventStream({ machineId, tenantId });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}
