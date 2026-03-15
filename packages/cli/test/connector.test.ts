import fs from 'fs';
import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { afterEach, describe, expect, it } from 'vitest';
import { getConnectorStatePath, readConnectorState, registerConnector, writeConnectorState } from '../src/connector';

const tempDirs: string[] = [];

function createTempDir(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), '0ctx-cli-connector-test-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    delete process.env.CTX_CONNECTOR_STATE_PATH;
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('connector state storage', () => {
    it('registers and persists connector state', () => {
        const tempDir = createTempDir();
        process.env.CTX_CONNECTOR_STATE_PATH = path.join(tempDir, 'connector.json');

        const { state, created } = registerConnector({
            uiUrl: 'https://app.0ctx.com'
        });

        expect(created).toBe(true);
        expect(state.machineId.length).toBeGreaterThan(0);
        expect(fs.existsSync(getConnectorStatePath())).toBe(true);

        const stored = readConnectorState();
        expect(stored?.uiUrl).toBe('https://app.0ctx.com');
        expect(stored?.runtime.eventQueuePending).toBe(0);
        expect(stored?.runtime.eventQueueReady).toBe(0);
        expect(stored?.runtime.eventQueueBackoff).toBe(0);
        expect(stored?.runtime.recoveryState).toBe('healthy');
        expect(stored?.runtime.consecutiveFailures).toBe(0);
        expect(stored?.runtime.lastHealthyAt).toBeNull();
        expect(stored?.runtime.lastRecoveryAt).toBeNull();
    });

    it('returns existing registration unless force is provided', () => {
        const tempDir = createTempDir();
        process.env.CTX_CONNECTOR_STATE_PATH = path.join(tempDir, 'connector.json');

        const first = registerConnector({
            uiUrl: 'https://app.0ctx.com'
        });
        const second = registerConnector({
            uiUrl: 'https://app.example.com'
        });

        expect(second.created).toBe(false);
        expect(second.state.machineId).toBe(first.state.machineId);
        expect(second.state.uiUrl).toBe('https://app.0ctx.com');

        const forced = registerConnector({
            uiUrl: 'https://app.example.com',
            force: true
        });

        expect(forced.state.machineId).toBe(first.state.machineId);
        expect(forced.state.uiUrl).toBe('https://app.example.com');
    });

    it('preserves runtime queue and recovery state on force re-registration', () => {
        const tempDir = createTempDir();
        process.env.CTX_CONNECTOR_STATE_PATH = path.join(tempDir, 'connector.json');

        const first = registerConnector({
            uiUrl: 'https://app.0ctx.com'
        });

        writeConnectorState({
            ...first.state,
            runtime: {
                ...first.state.runtime,
                eventQueuePending: 10,
                eventQueueReady: 3,
                eventQueueBackoff: 7,
                recoveryState: 'backoff',
                consecutiveFailures: 4,
                lastHealthyAt: 1000,
                lastRecoveryAt: 2000
            }
        });

        const forced = registerConnector({
            uiUrl: 'https://app.0ctx.com',
            force: true
        });

        expect(forced.state.runtime.eventQueuePending).toBe(10);
        expect(forced.state.runtime.eventQueueReady).toBe(3);
        expect(forced.state.runtime.eventQueueBackoff).toBe(7);
        expect(forced.state.runtime.recoveryState).toBe('backoff');
        expect(forced.state.runtime.consecutiveFailures).toBe(4);
        expect(forced.state.runtime.lastHealthyAt).toBe(1000);
        expect(forced.state.runtime.lastRecoveryAt).toBe(2000);
    });
});
