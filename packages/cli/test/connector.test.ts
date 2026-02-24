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
            tenantId: 'tenant-a',
            uiUrl: 'https://app.0ctx.com'
        });

        expect(created).toBe(true);
        expect(state.machineId.length).toBeGreaterThan(0);
        expect(fs.existsSync(getConnectorStatePath())).toBe(true);

        const stored = readConnectorState();
        expect(stored?.tenantId).toBe('tenant-a');
        expect(stored?.uiUrl).toBe('https://app.0ctx.com');
        expect(stored?.registrationMode).toBe('local');
        expect(stored?.cloud.registrationId).toBeNull();
        expect(stored?.runtime.daemonSessionToken).toBeNull();
        expect(stored?.runtime.eventSubscriptionId).toBeNull();
        expect(stored?.runtime.lastEventSequence).toBe(0);
        expect(stored?.runtime.eventBridgeSupported).toBe(true);
        expect(stored?.runtime.eventQueuePending).toBe(0);
        expect(stored?.runtime.eventQueueReady).toBe(0);
        expect(stored?.runtime.eventQueueBackoff).toBe(0);
        expect(stored?.runtime.lastCommandCursor).toBe(0);
        expect(stored?.runtime.lastCommandSyncAt).toBeNull();
        expect(stored?.runtime.commandBridgeSupported).toBe(true);
        expect(stored?.runtime.commandBridgeError).toBeNull();
    });

    it('returns existing registration unless force is provided', () => {
        const tempDir = createTempDir();
        process.env.CTX_CONNECTOR_STATE_PATH = path.join(tempDir, 'connector.json');

        const first = registerConnector({
            tenantId: 'tenant-a',
            uiUrl: 'https://app.0ctx.com'
        });
        const second = registerConnector({
            tenantId: 'tenant-b',
            uiUrl: 'https://app.example.com'
        });

        expect(second.created).toBe(false);
        expect(second.state.machineId).toBe(first.state.machineId);
        expect(second.state.tenantId).toBe('tenant-a');
        expect(second.state.uiUrl).toBe('https://app.0ctx.com');

        const forced = registerConnector({
            tenantId: 'tenant-b',
            uiUrl: 'https://app.example.com',
            force: true
        });

        expect(forced.state.machineId).toBe(first.state.machineId);
        expect(forced.state.tenantId).toBe('tenant-b');
        expect(forced.state.uiUrl).toBe('https://app.example.com');
        expect(forced.state.runtime.lastEventSequence).toBe(0);
    });

    it('resets event bridge support/runtime handles on force re-registration', () => {
        const tempDir = createTempDir();
        process.env.CTX_CONNECTOR_STATE_PATH = path.join(tempDir, 'connector.json');

        const first = registerConnector({
            tenantId: 'tenant-a',
            uiUrl: 'https://app.0ctx.com'
        });

        writeConnectorState({
            ...first.state,
            runtime: {
                ...first.state.runtime,
                daemonSessionToken: 'sess-old',
                eventSubscriptionId: 'sub-old',
                eventBridgeSupported: false,
                eventBridgeError: 'unsupported',
                lastEventSequence: 42,
                eventQueuePending: 10,
                eventQueueReady: 3,
                eventQueueBackoff: 7,
                lastCommandCursor: 21,
                lastCommandSyncAt: 1000,
                commandBridgeSupported: false,
                commandBridgeError: 'disabled'
            }
        });

        const forced = registerConnector({
            tenantId: 'tenant-a',
            uiUrl: 'https://app.0ctx.com',
            force: true
        });

        expect(forced.state.runtime.eventBridgeSupported).toBe(true);
        expect(forced.state.runtime.eventBridgeError).toBeNull();
        expect(forced.state.runtime.daemonSessionToken).toBeNull();
        expect(forced.state.runtime.eventSubscriptionId).toBeNull();
        expect(forced.state.runtime.lastEventSequence).toBe(42);
        expect(forced.state.runtime.eventQueuePending).toBe(10);
        expect(forced.state.runtime.eventQueueReady).toBe(3);
        expect(forced.state.runtime.eventQueueBackoff).toBe(7);
        expect(forced.state.runtime.lastCommandCursor).toBe(21);
        expect(forced.state.runtime.lastCommandSyncAt).toBe(1000);
        expect(forced.state.runtime.commandBridgeSupported).toBe(true);
        expect(forced.state.runtime.commandBridgeError).toBeNull();
    });
});
