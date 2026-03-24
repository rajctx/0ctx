import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HookCommandDeps } from '../src/commands/connector/hook/types';
import { createHookSessionStartCommand } from '../src/commands/connector/hook/session-start';

function createDeps(overrides: Partial<HookCommandDeps> = {}): HookCommandDeps {
    return {
        resolveRepoRoot: vi.fn((value: string | null) => value ?? 'C:\\repo'),
        parseOptionalStringFlag: vi.fn((value: string | boolean | undefined) => typeof value === 'string' ? value : null),
        resolveContextIdForHookIngest: vi.fn(async () => 'ctx-1'),
        validateExplicitPreviewSelection: vi.fn(() => null),
        validatePreviewOptIn: vi.fn(() => null),
        parseHookClients: vi.fn(() => []),
        installHooks: vi.fn(),
        readHookInstallState: vi.fn(),
        parsePositiveIntegerFlag: vi.fn((_value: string | boolean | undefined, fallback: number) => fallback),
        getHookDumpRetentionDays: vi.fn(() => 7),
        pruneHookDumps: vi.fn(),
        resolveHookCaptureRoot: vi.fn(() => 'C:\\repo'),
        validateHookIngestWorkspace: vi.fn(async () => ({ ok: true, captureRoot: 'C:\\repo', error: null })),
        extractSupportedHookAgent: vi.fn(),
        readStdinPayload: vi.fn(() => ''),
        normalizeHookPayload: vi.fn(),
        resolveHookTranscriptPath: vi.fn(() => null),
        resolveCodexSessionArchivePath: vi.fn(() => null),
        readCodexArchiveCapture: vi.fn(() => null),
        readTranscriptCapture: vi.fn(() => null),
        readCodexCapture: vi.fn(() => null),
        readInlineHookCapture: vi.fn(() => null),
        persistHookTranscriptSnapshot: vi.fn(() => null),
        persistHookTranscriptHistory: vi.fn(() => null),
        appendHookEventLog: vi.fn(() => null),
        persistHookDump: vi.fn(() => null),
        buildHookCaptureMeta: vi.fn(() => ({})),
        ensureChatSessionNode: vi.fn(async () => null),
        ensureChatCommitNode: vi.fn(async () => null),
        asRecord: vi.fn(() => null),
        safeGitValue: vi.fn(() => 'main'),
        sendToDaemon: vi.fn(async () => ({ workspaceName: 'Repo', promptText: 'pack' })),
        ...overrides
    } as HookCommandDeps;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('hook session-start', () => {
    it('fails open when daemon context lookup is unavailable', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const deps = createDeps({
            resolveContextIdForHookIngest: vi.fn(async () => {
                throw new Error('connect ENOENT \\\\.\\pipe\\0ctx.sock');
            })
        });

        const exitCode = await createHookSessionStartCommand(deps)('claude', { json: true }, {});

        expect(exitCode).toBe(0);
        expect(logSpy).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? 'null'))).toMatchObject({
            ok: true,
            injected: false,
            reason: 'daemon_unavailable',
            error: 'connect ENOENT \\\\.\\pipe\\0ctx.sock'
        });
    });
});
