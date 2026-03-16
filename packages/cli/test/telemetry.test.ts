import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { captureSpy, shutdownSpy, posthogCtorSpy } = vi.hoisted(() => {
    const capture = vi.fn();
    const shutdown = vi.fn(async () => {});
    const ctor = vi.fn(class PostHogMock {
        capture = capture;
        shutdown = shutdown;
    });

    return {
        captureSpy: capture,
        shutdownSpy: shutdown,
        posthogCtorSpy: ctor
    };
});

vi.mock('posthog-node', () => ({
    PostHog: posthogCtorSpy
}));

import { captureEvent, initTelemetry, shutdownTelemetry } from '../src/telemetry';

let tempDir = '';

describe('telemetry defaults', () => {
    beforeEach(() => {
        tempDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-telemetry-'));
        process.env.CTX_CONFIG_PATH = path.join(tempDir, 'config.json');
        delete process.env.CTX_DISABLE_TELEMETRY;
        delete process.env.CTX_TELEMETRY_ENABLED;
        delete process.env.CTX_POSTHOG_API_KEY;
        delete process.env.CTX_POSTHOG_HOST;
        captureSpy.mockClear();
        shutdownSpy.mockClear();
        posthogCtorSpy.mockClear();
    });

    afterEach(async () => {
        await shutdownTelemetry();
        delete process.env.CTX_CONFIG_PATH;
        delete process.env.CTX_DISABLE_TELEMETRY;
        delete process.env.CTX_TELEMETRY_ENABLED;
        delete process.env.CTX_POSTHOG_API_KEY;
        delete process.env.CTX_POSTHOG_HOST;
        if (tempDir) {
            rmSync(tempDir, { recursive: true, force: true });
            tempDir = '';
        }
    });

    it('stays disabled by default even when no explicit disable flag is present', () => {
        initTelemetry('machine-1');
        captureEvent('cli_command_executed', { command: 'status' });

        expect(posthogCtorSpy).not.toHaveBeenCalled();
        expect(captureSpy).not.toHaveBeenCalled();
    });

    it('requires both an opt-in flag and an API key before sending telemetry', () => {
        process.env.CTX_POSTHOG_API_KEY = 'phc_test_key';

        initTelemetry('machine-2');
        captureEvent('cli_command_executed', { command: 'status' });
        expect(posthogCtorSpy).not.toHaveBeenCalled();

        process.env.CTX_TELEMETRY_ENABLED = 'true';
        initTelemetry('machine-2');
        captureEvent('cli_command_executed', { command: 'status' });

        expect(posthogCtorSpy).toHaveBeenCalledWith('phc_test_key', expect.objectContaining({
            host: 'https://us.i.posthog.com',
            flushAt: 1,
            flushInterval: 0
        }));
        expect(captureSpy).toHaveBeenCalledWith(expect.objectContaining({
            distinctId: 'machine-2',
            event: 'cli_command_executed'
        }));
    });
});
