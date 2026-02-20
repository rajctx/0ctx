import path from 'path';

// Daemon-level active context memory.
// Maps connection IDs -> active context ID.
const sessionContexts = new Map<string, string>();

/**
 * Gets the active context ID for the given connection ID, if any.
 */
export function getActiveContext(connectionId: string): string | null {
    return sessionContexts.get(connectionId) || null;
}

/**
 * Sets the active context ID for the given connection ID.
 */
export function setActiveContext(connectionId: string, contextId: string): void {
    sessionContexts.set(connectionId, contextId);
}

/**
 * Clears the active context ID for the given connection ID.
 */
export function clearContext(connectionId: string): void {
    sessionContexts.delete(connectionId);
}
