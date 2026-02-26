/**
 * BFF HTTP client for calling /api/v1/* routes.
 * Used by server actions (actions.ts) and can be used from client components.
 */

const BFF_BASE =
  typeof window !== 'undefined'
    ? '' // Client-side: relative URLs
    : process.env.CTX_UI_BASE_URL || 'http://localhost:3000';

export interface BffResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: { code: string; message: string; retryable: boolean; correlationId: string };
}

export async function bffGet<T = unknown>(
  path: string,
  options: { params?: Record<string, string>; timeoutMs?: number } = {}
): Promise<BffResponse<T>> {
  const url = new URL(`${BFF_BASE}${path}`);
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    }
  }

  return bffFetch<T>(url.toString(), { method: 'GET', timeoutMs: options.timeoutMs });
}

export async function bffPost<T = unknown>(
  path: string,
  body?: unknown,
  options: { timeoutMs?: number } = {}
): Promise<BffResponse<T>> {
  return bffFetch<T>(`${BFF_BASE}${path}`, {
    method: 'POST',
    body,
    timeoutMs: options.timeoutMs
  });
}

export async function bffPut<T = unknown>(
  path: string,
  body?: unknown,
  options: { timeoutMs?: number } = {}
): Promise<BffResponse<T>> {
  return bffFetch<T>(`${BFF_BASE}${path}`, {
    method: 'PUT',
    body,
    timeoutMs: options.timeoutMs
  });
}

async function bffFetch<T>(
  url: string,
  options: { method: string; body?: unknown; timeoutMs?: number }
): Promise<BffResponse<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 30_000
  );

  try {
    const fetchOptions: RequestInit = {
      method: options.method,
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal
    };

    if (options.body !== undefined) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOptions);
    const data = await parseJson<T>(response);

    if (!response.ok) {
      const errorBody = data as unknown as {
        error?: { code: string; message: string; retryable: boolean; correlationId: string };
      };
      return {
        ok: false,
        status: response.status,
        data: null,
        error: errorBody?.error ?? {
          code: 'unknown',
          message: `BFF returned ${response.status}`,
          retryable: response.status >= 500,
          correlationId: ''
        }
      };
    }

    return { ok: true, status: response.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: {
        code: 'network_error',
        message: err instanceof Error ? err.message : 'Network error',
        retryable: true,
        correlationId: ''
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function parseJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
