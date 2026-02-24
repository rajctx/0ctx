#!/usr/bin/env node
const http = require('http');
const { randomUUID } = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const DEFAULT_CAPABILITIES = ['sync', 'blackboard', 'commands'];
const DEFAULT_STREAM_BASE = process.env.STREAM_BASE_URL || `ws://${HOST}:${PORT}/v1/connectors/stream`;

/** @type {Map<string, {
 * machineId: string,
 * tenantId: string | null,
 * registrationId: string,
 * streamUrl: string,
 * capabilities: string[],
 * registeredAt: number,
 * lastHeartbeatAt: number | null,
 * posture: string | null
 * }>} */
const connectors = new Map();

/** @type {Map<string, { nonce: string, createdAt: number }>} */
const trustChallenges = new Map();

/** @type {Map<string, Array<{
 * commandId: string,
 * cursor: number,
 * tenantId: string | null,
 * contextId: string | null,
 * method: string,
 * params: Record<string, unknown>,
 * createdAt: number,
 * status: 'pending' | 'applied' | 'failed',
 * error?: string
 * }>>} */
const commandQueues = new Map();

/** @type {Array<{ machineId: string, tenantId: string | null, subscriptionId: string, cursor: number, events: unknown[], receivedAt: number }>} */
const eventIngestLog = [];
let globalCommandCursor = 0;

function sendJson(res, statusCode, body, req) {
  const payload = JSON.stringify(body, null, 2);
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  };
  // OPS-001: Propagate X-Request-Id for distributed tracing
  const requestId = req?.headers?.['x-request-id'];
  if (requestId) headers['X-Request-Id'] = requestId;
  res.writeHead(statusCode, headers);
  res.end(payload);
}

function parseBearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

function requireAuth(req, res) {
  const token = parseBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'unauthorized', message: 'Missing bearer token' }, req);
    return null;
  }
  return token;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function getQueue(machineId) {
  const queue = commandQueues.get(machineId) || [];
  commandQueues.set(machineId, queue);
  return queue;
}

function enqueueCommand(machineId, tenantId, method, params, contextId) {
  const queue = getQueue(machineId);
  const command = {
    commandId: randomUUID(),
    cursor: ++globalCommandCursor,
    tenantId: tenantId || null,
    contextId: contextId || null,
    method,
    params: params || {},
    createdAt: Date.now(),
    status: 'pending'
  };
  queue.push(command);
  return command;
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const path = parsed.pathname;
  const method = req.method || 'GET';

  try {
    if (path === '/v1/connectors/register' && method === 'POST') {
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req);
      const machineId = typeof body.machineId === 'string' ? body.machineId : null;
      if (!machineId) {
        sendJson(res, 400, { error: 'invalid_request', message: 'machineId is required' }, req);
        return;
      }

      const tenantId = typeof body.tenantId === 'string' ? body.tenantId : null;
      const existing = connectors.get(machineId);
      const registration = existing || {
        machineId,
        tenantId,
        registrationId: `reg_${randomUUID()}`,
        streamUrl: DEFAULT_STREAM_BASE,
        capabilities: [...DEFAULT_CAPABILITIES],
        registeredAt: Date.now(),
        lastHeartbeatAt: null,
        posture: null
      };

      registration.tenantId = tenantId;
      connectors.set(machineId, registration);

      // SEC-001: Issue trust challenge nonce
      const nonce = randomUUID();
      trustChallenges.set(machineId, { nonce, createdAt: Date.now() });

      sendJson(res, 200, {
        registrationId: registration.registrationId,
        streamUrl: registration.streamUrl,
        capabilities: registration.capabilities,
        tenantId: registration.tenantId,
        trustChallenge: nonce,
        trustLevel: registration.trustLevel || 'unverified'
      }, req);
      return;
    }

    // SEC-001: Trust challenge verification
    if (path === '/v1/connectors/trust/verify' && method === 'POST') {
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req);
      const machineId = typeof body.machineId === 'string' ? body.machineId : null;
      const challengeResponse = typeof body.challengeResponse === 'string' ? body.challengeResponse : null;
      if (!machineId || !challengeResponse || !connectors.has(machineId)) {
        sendJson(res, 400, { error: 'invalid_request', message: 'machineId and challengeResponse are required' }, req);
        return;
      }

      const challenge = trustChallenges.get(machineId);
      if (!challenge) {
        sendJson(res, 400, { error: 'no_challenge', message: 'No pending trust challenge for this machine' }, req);
        return;
      }

      // Accept the challenge response (in production, verify HMAC signature)
      const connector = connectors.get(machineId);
      connector.trustLevel = 'verified';
      connector.trustVerifiedAt = Date.now();
      trustChallenges.delete(machineId);

      sendJson(res, 200, { accepted: true, trustLevel: 'verified' }, req);
      return;
    }

    if (path === '/v1/connectors/heartbeat' && method === 'POST') {
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req);
      const machineId = typeof body.machineId === 'string' ? body.machineId : null;
      if (!machineId || !connectors.has(machineId)) {
        sendJson(res, 404, { error: 'not_found', message: 'connector not registered' }, req);
        return;
      }
      const connector = connectors.get(machineId);
      connector.lastHeartbeatAt = Date.now();
      connector.posture = typeof body.posture === 'string' ? body.posture : null;
      sendJson(res, 200, { accepted: true, serverTime: new Date().toISOString() }, req);
      return;
    }

    if (path === '/v1/connectors/capabilities' && method === 'GET') {
      if (!requireAuth(req, res)) return;
      const machineId = parsed.searchParams.get('machineId');
      if (!machineId || !connectors.has(machineId)) {
        sendJson(res, 404, { error: 'not_found', message: 'connector not registered' }, req);
        return;
      }
      const connector = connectors.get(machineId);
      sendJson(res, 200, {
        capabilities: connector.capabilities,
        posture: connector.posture || 'degraded'
      }, req);
      return;
    }

    if (path === '/v1/connectors/events' && method === 'POST') {
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req);
      const machineId = typeof body.machineId === 'string' ? body.machineId : null;
      if (!machineId || !connectors.has(machineId)) {
        sendJson(res, 404, { error: 'not_found', message: 'connector not registered' }, req);
        return;
      }
      eventIngestLog.push({
        machineId,
        tenantId: typeof body.tenantId === 'string' ? body.tenantId : null,
        subscriptionId: typeof body.subscriptionId === 'string' ? body.subscriptionId : '',
        cursor: typeof body.cursor === 'number' ? body.cursor : 0,
        events: Array.isArray(body.events) ? body.events : [],
        receivedAt: Date.now()
      });
      sendJson(res, 200, { accepted: true, processed: Array.isArray(body.events) ? body.events.length : 0 }, req);
      return;
    }

    if (path === '/v1/connectors/commands' && method === 'GET') {
      if (!requireAuth(req, res)) return;
      const machineId = parsed.searchParams.get('machineId');
      const cursor = Number(parsed.searchParams.get('cursor') || '0');
      if (!machineId || !connectors.has(machineId)) {
        sendJson(res, 404, { error: 'not_found', message: 'connector not registered' }, req);
        return;
      }
      const queue = getQueue(machineId);
      const pending = queue
        .filter(item => item.status === 'pending' && item.cursor > cursor)
        .slice(0, 200)
        .map(item => ({
          commandId: item.commandId,
          cursor: item.cursor,
          contextId: item.contextId,
          method: item.method,
          params: item.params,
          createdAt: item.createdAt
        }));

      const latestCursor = pending.length > 0 ? pending[pending.length - 1].cursor : cursor;
      sendJson(res, 200, { cursor: latestCursor, commands: pending }, req);
      return;
    }

    if (path === '/v1/connectors/commands/ack' && method === 'POST') {
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req);
      const machineId = typeof body.machineId === 'string' ? body.machineId : null;
      const commandId = typeof body.commandId === 'string' ? body.commandId : null;
      if (!machineId || !commandId || !connectors.has(machineId)) {
        sendJson(res, 400, { error: 'invalid_request', message: 'machineId and commandId are required' }, req);
        return;
      }

      const queue = getQueue(machineId);
      const target = queue.find(item => item.commandId === commandId);
      if (!target) {
        sendJson(res, 404, { error: 'not_found', message: 'command not found' }, req);
        return;
      }

      target.status = body.status === 'failed' ? 'failed' : 'applied';
      target.error = typeof body.error === 'string' ? body.error : undefined;
      target.result = body.result !== undefined ? body.result : null;
      sendJson(res, 200, { accepted: true }, req);
      return;
    }

    // Synchronous command execution: enqueue + poll-until-ack.
    if (path === '/v1/connectors/commands/exec' && method === 'POST') {
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req);
      const machineId = typeof body.machineId === 'string' ? body.machineId : null;
      const methodName = typeof body.method === 'string' ? body.method : null;
      if (!machineId || !methodName || !connectors.has(machineId)) {
        sendJson(res, 400, { error: 'invalid_request', message: 'machineId and method are required, and connector must be registered' }, req);
        return;
      }
      const command = enqueueCommand(
        machineId,
        typeof body.tenantId === 'string' ? body.tenantId : null,
        methodName,
        typeof body.params === 'object' && body.params ? body.params : {},
        typeof body.contextId === 'string' ? body.contextId : null
      );
      const pollTimeoutMs = typeof body.timeoutMs === 'number' ? Math.min(body.timeoutMs, 120000) : 15000;
      const pollIntervalMs = 250;
      const deadline = Date.now() + pollTimeoutMs;
      const poll = () => {
        if (command.status !== 'pending') {
          sendJson(res, 200, {
            ok: command.status === 'applied',
            commandId: command.commandId,
            status: command.status,
            result: command.result || null,
            error: command.error || null
          }, req);
          return;
        }
        if (Date.now() >= deadline) {
          sendJson(res, 200, {
            ok: false,
            commandId: command.commandId,
            status: 'timeout',
            result: null,
            error: `Command not acknowledged within ${pollTimeoutMs}ms`
          }, req);
          return;
        }
        setTimeout(poll, pollIntervalMs);
      };
      poll();
      return;
    }

    // Local dev helper: enqueue command for a connector.
    if (path === '/v1/connectors/commands/enqueue' && method === 'POST') {
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req);
      const machineId = typeof body.machineId === 'string' ? body.machineId : null;
      const methodName = typeof body.method === 'string' ? body.method : null;
      if (!machineId || !methodName || !connectors.has(machineId)) {
        sendJson(res, 400, { error: 'invalid_request', message: 'machineId and method are required' }, req);
        return;
      }
      const command = enqueueCommand(
        machineId,
        typeof body.tenantId === 'string' ? body.tenantId : null,
        methodName,
        typeof body.params === 'object' && body.params ? body.params : {},
        typeof body.contextId === 'string' ? body.contextId : null
      );
      sendJson(res, 200, { accepted: true, command }, req);
      return;
    }

    // OPS-001: Metrics endpoint
    if (path === '/v1/metrics' && method === 'GET') {
      const uptimeMs = process.uptime() * 1000;
      const totalCommands = [...commandQueues.values()].reduce((acc, q) => acc + q.length, 0);
      const pendingCommands = [...commandQueues.values()].reduce((acc, q) => acc + q.filter(item => item.status === 'pending').length, 0);
      const lines = [
        '# TYPE ctx_control_plane_uptime_ms gauge',
        `ctx_control_plane_uptime_ms ${Math.round(uptimeMs)}`,
        '# TYPE ctx_connectors_registered gauge',
        `ctx_connectors_registered ${connectors.size}`,
        '# TYPE ctx_commands_total counter',
        `ctx_commands_total ${totalCommands}`,
        '# TYPE ctx_commands_pending gauge',
        `ctx_commands_pending ${pendingCommands}`,
        '# TYPE ctx_events_ingested_total counter',
        `ctx_events_ingested_total ${eventIngestLog.length}`,
        ''
      ];
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(lines.join('\n'));
      return;
    }

    if (path === '/v1/health' && method === 'GET') {
      const mem = process.memoryUsage();
      sendJson(res, 200, {
        status: 'ok',
        uptimeMs: Math.round(process.uptime() * 1000),
        node: process.version,
        connectors: connectors.size,
        queuedCommands: [...commandQueues.values()].reduce((acc, q) => acc + q.filter(item => item.status === 'pending').length, 0),
        ingestedBatches: eventIngestLog.length,
        memoryMb: {
          rss: Math.round(mem.rss / 1048576),
          heapUsed: Math.round(mem.heapUsed / 1048576),
          heapTotal: Math.round(mem.heapTotal / 1048576)
        }
      }, req);
      return;
    }

    sendJson(res, 404, { error: 'not_found', message: `${method} ${path}` }, req);
  } catch (error) {
    sendJson(res, 500, {
      error: 'internal_error',
      message: error instanceof Error ? error.message : String(error)
    }, req);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`0ctx control-plane dev server listening on http://${HOST}:${PORT}/v1`);
});
