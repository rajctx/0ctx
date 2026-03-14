import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { DaemonStatus, DesktopPosture } from '../../shared/types/domain';

interface RequestEnvelope {
  method: string;
  params: Record<string, unknown>;
  requestId: string;
  apiVersion: '2';
  sessionToken?: string;
}

interface ResponseEnvelope {
  ok: boolean;
  result?: unknown;
  error?: string;
}

function resolveSocketPath() {
  if (process.env.CTX_SOCKET_PATH) {
    return process.env.CTX_SOCKET_PATH;
  }
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\0ctx.sock';
  }
  return path.join(os.homedir(), '.0ctx', '0ctx.sock');
}

function resolveStorage() {
  const dataDir = process.env.CTX_DATA_DIR || path.join(os.homedir(), '.0ctx');
  return {
    dataDir,
    dbPath: process.env.CTX_DB_PATH || path.join(dataDir, '0ctx.db'),
    socketPath: resolveSocketPath(),
    hookStatePath: process.env.CTX_HOOK_STATE_PATH || path.join(dataDir, 'hooks-state.json')
  };
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isDaemonUnavailableError(error: unknown) {
  const message = describeError(error).toLowerCase();
  return (
    message.includes('enoent')
    || message.includes('econnrefused')
    || message.includes('econnreset')
    || message.includes('epipe')
    || message.includes('connect')
    || message.includes('pipe')
    || message.includes('socket hang up')
    || message.includes('daemon_empty_response')
  );
}

function buildUnavailableStatus(error: unknown): DaemonStatus {
  return {
    health: {
      status: 'offline',
      error: describeError(error)
    },
    contexts: [],
    capabilities: {
      methods: []
    },
    storage: resolveStorage()
  };
}

function buildDegradedStatus(error: unknown, contexts: DaemonStatus['contexts'], methods: string[]): DaemonStatus {
  return {
    health: {
      status: 'degraded',
      error: describeError(error)
    },
    contexts,
    capabilities: {
      methods
    },
    storage: resolveStorage()
  };
}

export class DaemonClient {
  private sessionToken: string | null = null;
  private unavailableUntil = 0;
  private unavailableReason: string | null = null;

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}) {
    this.throwIfUnavailable();

    if (method === 'createSession') {
      return this.rawRequest<T>(method, params);
    }

    if (!this.sessionToken) {
      await this.ensureSession();
    }

    try {
      return await this.rawRequest<T>(method, params, this.sessionToken ?? undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('Invalid sessionToken')) {
        throw error;
      }
      this.sessionToken = null;
      await this.ensureSession();
      return this.rawRequest<T>(method, params, this.sessionToken ?? undefined);
    }
  }

  async getStatus(): Promise<DaemonStatus> {
    const [healthResult, contextsResult, capabilitiesResult] = await Promise.allSettled([
      this.call<Record<string, unknown>>('health', {}),
      this.call<DaemonStatus['contexts']>('listContexts', {}),
      this.call<Record<string, unknown>>('getCapabilities', {})
    ]);

    const contexts = contextsResult.status === 'fulfilled' && Array.isArray(contextsResult.value)
      ? contextsResult.value
      : [];
    const methods = capabilitiesResult.status === 'fulfilled' && Array.isArray((capabilitiesResult.value as { methods?: unknown }).methods)
      ? ((capabilitiesResult.value as { methods: string[] }).methods)
      : [];

    if (healthResult.status === 'fulfilled') {
      return {
        health: healthResult.value,
        contexts,
        capabilities: {
          methods
        },
        storage: resolveStorage()
      };
    }

    const error = healthResult.reason;
    if (isDaemonUnavailableError(error)) {
      if (contexts.length > 0 || methods.length > 0) {
        return buildDegradedStatus(error, contexts, methods);
      }
      return buildUnavailableStatus(error);
    }

    throw error;
  }

  async getPosture(): Promise<DesktopPosture> {
    const status = await this.getStatus();
    const healthState = String(status.health?.status ?? '').toLowerCase();

    if (healthState === 'ok') {
      return 'Connected';
    }
    if (healthState === 'degraded') {
      return 'Degraded';
    }
    if (status.contexts.length > 0 || status.capabilities.methods.length > 0) {
      return 'Degraded';
    }
    return 'Offline';
  }

  private async ensureSession() {
    const created = await this.rawRequest<{ sessionToken?: string }>('createSession', {});
    const token = typeof created.sessionToken === 'string' ? created.sessionToken : '';
    if (!token) {
      throw new Error('createSession returned no sessionToken.');
    }
    this.sessionToken = token;
  }

  private async rawRequest<T>(
    method: string,
    params: Record<string, unknown>,
    sessionToken?: string
  ): Promise<T> {
    const request: RequestEnvelope = {
      method,
      params,
      requestId: `desktop-electron-${method}-${Date.now()}`,
      apiVersion: '2',
      ...(sessionToken ? { sessionToken } : {})
    };

    try {
      const payload = `${JSON.stringify(request)}\n`;
      const responseLine = await new Promise<string>((resolve, reject) => {
        const socket = net.createConnection(resolveSocketPath());
        let buffer = '';
        socket.on('connect', () => {
          socket.write(payload);
        });
        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          const newlineIndex = buffer.indexOf('\n');
          if (newlineIndex === -1) {
            return;
          }
          const message = buffer.slice(0, newlineIndex).trim();
          socket.destroy();
          resolve(message);
        });
        socket.on('error', (error) => reject(error));
        socket.on('end', () => {
          if (buffer.trim()) {
            resolve(buffer.trim());
            return;
          }
          reject(new Error(`daemon_empty_response:${method}`));
        });
      });

      const response = JSON.parse(responseLine) as ResponseEnvelope;
      this.clearUnavailable();
      if (!response.ok) {
        throw new Error(response.error || 'daemon_error');
      }
      return (response.result ?? {}) as T;
    } catch (error) {
      if (error instanceof SyntaxError) {
        const parseError = new Error(`daemon_invalid_json:${method}:${describeError(error)}`);
        this.noteUnavailable(parseError);
        throw parseError;
      }
      this.noteUnavailable(error);
      throw error;
    }
  }

  private noteUnavailable(error: unknown) {
    if (!isDaemonUnavailableError(error)) {
      return;
    }
    this.sessionToken = null;
    this.unavailableReason = describeError(error);
    this.unavailableUntil = Date.now() + 3_000;
  }

  private clearUnavailable() {
    this.unavailableReason = null;
    this.unavailableUntil = 0;
  }

  private throwIfUnavailable() {
    if (this.unavailableUntil > Date.now()) {
      throw new Error(this.unavailableReason ?? 'daemon_unavailable');
    }
  }
}
