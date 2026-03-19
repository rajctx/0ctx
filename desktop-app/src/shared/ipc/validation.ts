import type {
  DaemonStatus,
  DesktopEventMessage,
  DesktopPreferences,
  DesktopPosture,
  RuntimeStatus
} from '../types/domain';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function ensureObject(value: unknown, label: string): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

export function ensureString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

export function ensureOptionalString(value: unknown, label: string): string | null | undefined {
  if (typeof value === 'undefined' || value === null) {
    return value as null | undefined;
  }
  return ensureString(value, label);
}

export function ensureDesktopPosture(value: unknown): DesktopPosture {
  const posture = ensureString(value, 'Posture');
  if (posture !== 'Connected' && posture !== 'Degraded' && posture !== 'Offline') {
    throw new Error(`Unsupported posture "${posture}".`);
  }
  return posture;
}

export function ensureDaemonStatus(value: unknown): DaemonStatus {
  const payload = ensureObject(value, 'Daemon status');
  return {
    health: ensureObject(payload.health ?? {}, 'Health'),
    contexts: Array.isArray(payload.contexts) ? (payload.contexts as DaemonStatus['contexts']) : [],
    capabilities: {
      methods: Array.isArray((payload.capabilities as Record<string, unknown> | undefined)?.methods)
        ? ((payload.capabilities as Record<string, unknown>).methods as string[])
        : []
    },
    storage: isObject(payload.storage) ? (payload.storage as DaemonStatus['storage']) : {}
  };
}

export function ensureRuntimeStatus(value: unknown): RuntimeStatus {
  const payload = ensureObject(value, 'Runtime status');
  return {
    running: Boolean(payload.running),
    lastError: typeof payload.lastError === 'string' ? payload.lastError : null
  };
}

export function ensurePreferences(value: unknown): DesktopPreferences {
  const payload = ensureObject(value, 'Preferences');
  const theme = payload.theme === 'dawn' ? 'dawn' : 'midnight';
  const lastRoute = typeof payload.lastRoute === 'string' ? payload.lastRoute : 'overview';
  return { theme, lastRoute };
}

export function ensureEventMessage(value: unknown): DesktopEventMessage {
  const payload = ensureObject(value, 'Desktop event');
  return {
    kind: ensureString(payload.kind, 'Event kind') as DesktopEventMessage['kind'],
    posture: typeof payload.posture === 'string' ? ensureDesktopPosture(payload.posture) : undefined,
    payload: isObject(payload.payload) ? payload.payload : undefined
  };
}
