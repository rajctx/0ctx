import { randomUUID } from 'crypto';

export interface SessionState {
    sessionToken: string;
    contextId: string | null;
    createdAt: number;
    lastSeenAt: number;
}

// Backward-compatible connection state for clients that do not send a session token.
const connectionContexts = new Map<string, string>();

// Session token state that survives per-request socket reconnections.
const sessions = new Map<string, SessionState>();

export function createSession(initialContextId: string | null = null): SessionState {
    const now = Date.now();
    const session: SessionState = {
        sessionToken: randomUUID(),
        contextId: initialContextId,
        createdAt: now,
        lastSeenAt: now
    };
    sessions.set(session.sessionToken, session);
    return session;
}

export function touchSession(sessionToken: string): SessionState | null {
    const session = sessions.get(sessionToken);
    if (!session) return null;

    session.lastSeenAt = Date.now();
    return session;
}

export function getSessionContext(sessionToken: string): string | null {
    return sessions.get(sessionToken)?.contextId ?? null;
}

export function setSessionContext(sessionToken: string, contextId: string): void {
    const session = sessions.get(sessionToken);
    if (!session) return;

    session.contextId = contextId;
    session.lastSeenAt = Date.now();
}

export function clearSessionContext(sessionToken: string): void {
    const session = sessions.get(sessionToken);
    if (!session) return;

    session.contextId = null;
    session.lastSeenAt = Date.now();
}

/**
 * Gets the active context ID for the given connection ID, if any.
 */
export function getConnectionContext(connectionId: string): string | null {
    return connectionContexts.get(connectionId) || null;
}

/**
 * Sets the active context ID for the given connection ID.
 */
export function setConnectionContext(connectionId: string, contextId: string): void {
    connectionContexts.set(connectionId, contextId);
}

/**
 * Clears the active context ID for the given connection ID.
 */
export function clearConnectionContext(connectionId: string): void {
    connectionContexts.delete(connectionId);
}

export function resetResolverStateForTests(): void {
    connectionContexts.clear();
    sessions.clear();
}
