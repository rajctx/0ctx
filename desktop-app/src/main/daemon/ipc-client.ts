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

export class DaemonClient {
  private sessionToken: string | null = null;

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}) {
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
    try {
      const [health, contexts, capabilities] = await Promise.all([
        this.call<Record<string, unknown>>('health', {}),
        this.call<DaemonStatus['contexts']>('listContexts', {}).catch(() => []),
        this.call<Record<string, unknown>>('getCapabilities', {}).catch(() => ({ methods: [] }))
      ]);

      return {
        health,
        contexts: Array.isArray(contexts) ? contexts : [],
        capabilities: {
          methods: Array.isArray((capabilities as { methods?: unknown }).methods)
            ? ((capabilities as { methods: string[] }).methods)
            : []
        },
        storage: resolveStorage()
      };
    } catch (error) {
      if (isDaemonUnavailableError(error)) {
        return buildUnavailableStatus(error);
      }
      throw error;
    }
  }

  async getPosture(): Promise<DesktopPosture> {
    try {
      await this.call('health', {});
      return 'Connected';
    } catch (error) {
      if (isDaemonUnavailableError(error)) {
        return 'Offline';
      }
      return 'Degraded';
    }
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

    const payload = `${JSON.stringify(request)}\n`;
    const responseLine = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection(resolveSocketPath(), () => {
        socket.write(payload);
        socket.end();
      });
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
      });
      socket.on('end', () => resolve(buffer.trim()));
      socket.on('error', (error) => reject(error));
    });

    if (!responseLine) {
      throw new Error(`daemon_empty_response:${method}`);
    }

    let response: ResponseEnvelope;
    try {
      response = JSON.parse(responseLine) as ResponseEnvelope;
    } catch (error) {
      throw new Error(`daemon_invalid_json:${method}:${describeError(error)}`);
    }
    if (!response.ok) {
      throw new Error(response.error || 'daemon_error');
    }
    return (response.result ?? {}) as T;
  }
}
