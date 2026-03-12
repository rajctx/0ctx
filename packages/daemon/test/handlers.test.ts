import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Graph, openDb } from '@0ctx/core';
import { handleRequest } from '../src/handlers';
import { EventRuntime } from '../src/events';
import { resetResolverStateForTests } from '../src/resolver';
import type { HandlerRuntimeContext } from '../src/handlers';

const tempDirs: string[] = [];
let previousConfigPath: string | undefined;

function createGraph() {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-daemon-handlers-'));
    tempDirs.push(tempDir);
    const db = openDb({ dbPath: path.join(tempDir, '0ctx.db') });
    return { db, graph: new Graph(db) };
}

function runtime(): HandlerRuntimeContext {
    return {
        startedAt: Date.now(),
        getMetricsSnapshot: () => ({
            startedAt: Date.now(),
            uptimeMs: 0,
            totalRequests: 0,
            methods: {}
        })
    };
}

function gitAvailable(): boolean {
    return spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }).status === 0;
}

beforeEach(() => {
    resetResolverStateForTests();
    previousConfigPath = process.env.CTX_CONFIG_PATH;
    const configDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-daemon-config-'));
    tempDirs.push(configDir);
    process.env.CTX_CONFIG_PATH = path.join(configDir, 'config.json');
});

afterEach(() => {
    if (previousConfigPath === undefined) {
        delete process.env.CTX_CONFIG_PATH;
    } else {
        process.env.CTX_CONFIG_PATH = previousConfigPath;
    }
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('daemon request handling', () => {
    it('rejects context-bound operations when no active context exists', () => {
        const { db, graph } = createGraph();
        try {
            expect(() => {
                handleRequest(graph, 'conn-1', {
                    method: 'addNode',
                    params: { type: 'goal', content: 'test node' }
                }, runtime());
            }).toThrow(/No active context set/);
        } finally {
            db.close();
        }
    });

    it('persists active context across socket reconnections using sessionToken', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-a', { method: 'createSession' }, runtime()) as { sessionToken: string };

            const context = handleRequest(graph, 'conn-a', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'enterprise-rollout' }
            }, runtime()) as { id: string };

            const node = handleRequest(graph, 'conn-b', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'decision', content: 'Ship session-aware protocol' }
            }, runtime()) as { contextId: string };

            expect(node.contextId).toBe(context.id);
        } finally {
            db.close();
        }
    });

    it('writes audit events for mutating calls', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-a', { method: 'createSession' }, runtime()) as { sessionToken: string };

            const context = handleRequest(graph, 'conn-a', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'audit-context', actor: 'test-user', source: 'test-suite' }
            }, runtime()) as { id: string };

            handleRequest(graph, 'conn-a', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'goal', content: 'Capture auditable mutations' }
            }, runtime());

            const events = handleRequest(graph, 'conn-a', {
                method: 'listAuditEvents',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, limit: 10 }
            }, runtime()) as Array<{ action: string; sessionToken: string | null }>;

            expect(events.length).toBeGreaterThan(0);
            expect(events.some(event => event.action === 'create_context')).toBe(true);
            expect(events.some(event => event.action === 'add_node')).toBe(true);
            expect(events.every(event => event.sessionToken === session.sessionToken)).toBe(true);
        } finally {
            db.close();
        }
    });

    it('allows the runtime to request a graceful daemon shutdown', () => {
        const { db, graph } = createGraph();
        let shutdownRequested = false;
        try {
            const result = handleRequest(graph, 'conn-shutdown', {
                method: 'shutdown'
            }, {
                ...runtime(),
                requestShutdown: () => {
                    shutdownRequested = true;
                }
            }) as { status: string };

            expect(result.status).toBe('shutting_down');
            expect(shutdownRequested).toBe(true);
        } finally {
            db.close();
        }
    });

    it('reports only GA integration defaults by default when no hook state exists yet', () => {
        const { db, graph } = createGraph();
        const hookStatePath = path.join(path.dirname(db.name), 'missing-hooks-state.json');
        const previousHookStatePath = process.env.CTX_HOOK_STATE_PATH;
        try {
            process.env.CTX_HOOK_STATE_PATH = hookStatePath;

            const hookHealth = handleRequest(graph, 'conn-hook-health', {
                method: 'getHookHealth',
                params: {}
            }, runtime()) as {
                capturePolicy: {
                    captureRetentionDays: number;
                    debugRetentionDays: number;
                    debugArtifactsEnabled: boolean;
                };
                agents: Array<{ agent: string; notes: string | null; sessionStartInstalled: boolean }>;
                previewAgents: Array<{ agent: string }>;
            };

            const byAgent = new Map(hookHealth.agents.map((agent) => [agent.agent, agent.notes]));
            const sessionStartByAgent = new Map(hookHealth.agents.map((agent) => [agent.agent, agent.sessionStartInstalled]));
            expect(hookHealth.capturePolicy.captureRetentionDays).toBe(14);
            expect(hookHealth.capturePolicy.debugRetentionDays).toBe(7);
            expect(hookHealth.capturePolicy.debugArtifactsEnabled).toBe(false);
            expect(byAgent.get('claude')).toBe('supported');
            expect(byAgent.get('factory')).toBe('supported');
            expect(byAgent.get('antigravity')).toBe('supported');
            expect(byAgent.has('codex')).toBe(false);
            expect(byAgent.has('cursor')).toBe(false);
            expect(byAgent.has('windsurf')).toBe(false);
            expect(hookHealth.previewAgents).toEqual([]);
            expect(sessionStartByAgent.get('claude')).toBe(false);
            expect(sessionStartByAgent.get('factory')).toBe(false);
            expect(sessionStartByAgent.get('antigravity')).toBe(false);
        } finally {
            if (previousHookStatePath === undefined) {
                delete process.env.CTX_HOOK_STATE_PATH;
            } else {
                process.env.CTX_HOOK_STATE_PATH = previousHookStatePath;
            }
            db.close();
        }
    });

    it('includes preview integrations only when explicitly requested', () => {
        const { db, graph } = createGraph();
        const hookStatePath = path.join(path.dirname(db.name), 'missing-hooks-state.json');
        const previousHookStatePath = process.env.CTX_HOOK_STATE_PATH;
        try {
            process.env.CTX_HOOK_STATE_PATH = hookStatePath;

            const hookHealth = handleRequest(graph, 'conn-hook-health-preview', {
                method: 'getHookHealth',
                params: { includePreview: true }
            }, runtime()) as {
                agents: Array<{ agent: string; notes: string | null }>;
                previewAgents: Array<{ agent: string; notes: string | null }>;
            };

            const byAgent = new Map(hookHealth.agents.map((agent) => [agent.agent, agent.notes]));
            const previewByAgent = new Map(hookHealth.previewAgents.map((agent) => [agent.agent, agent.notes]));
            expect(byAgent.get('claude')).toBe('supported');
            expect(byAgent.get('factory')).toBe('supported');
            expect(byAgent.get('antigravity')).toBe('supported');
            expect(previewByAgent.get('codex')).toBe('preview-notify-archive');
            expect(previewByAgent.get('cursor')).toBe('preview-hook');
            expect(previewByAgent.get('windsurf')).toBe('preview-hook');
        } finally {
            if (previousHookStatePath === undefined) {
                delete process.env.CTX_HOOK_STATE_PATH;
            } else {
                process.env.CTX_HOOK_STATE_PATH = previousHookStatePath;
            }
            db.close();
        }
    });

    it('gets and sets per-context sync policy with audit trail', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-sync', { method: 'createSession' }, runtime()) as { sessionToken: string };

            const context = handleRequest(graph, 'conn-sync', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'sync-policy-context', syncPolicy: 'metadata_only' }
            }, runtime()) as { id: string };

            const before = handleRequest(graph, 'conn-sync', {
                method: 'getSyncPolicy',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as { syncPolicy: string };

            const after = handleRequest(graph, 'conn-sync', {
                method: 'setSyncPolicy',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, syncPolicy: 'full_sync', actor: 'test-user', source: 'test-suite' }
            }, runtime()) as { syncPolicy: string };

            const events = handleRequest(graph, 'conn-sync', {
                method: 'listAuditEvents',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, limit: 10 }
            }, runtime()) as Array<{ action: string }>;

            expect(before.syncPolicy).toBe('metadata_only');
            expect(after.syncPolicy).toBe('full_sync');
            expect(events.some(event => event.action === 'set_sync_policy')).toBe(true);
        } finally {
            db.close();
        }
    });

    it('returns a unified data policy for default and resolved workspace state', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-data-policy', { method: 'createSession' }, runtime()) as { sessionToken: string };

            const defaultPolicy = handleRequest(graph, 'conn-data-policy', {
                method: 'getDataPolicy',
                sessionToken: session.sessionToken,
                params: {}
            }, runtime()) as {
                workspaceResolved: boolean;
                contextId: string | null;
                syncScope: string;
                captureScope: string;
                debugScope: string;
                syncPolicy: string;
                captureRetentionDays: number;
                debugRetentionDays: number;
                debugArtifactsEnabled: boolean;
            };

            const context = handleRequest(graph, 'conn-data-policy', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'data-policy-context', syncPolicy: 'full_sync' }
            }, runtime()) as { id: string };

            const resolvedPolicy = handleRequest(graph, 'conn-data-policy', {
                method: 'getDataPolicy',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as {
                workspaceResolved: boolean;
                contextId: string | null;
                syncScope: string;
                captureScope: string;
                debugScope: string;
                syncPolicy: string;
                captureRetentionDays: number;
                debugRetentionDays: number;
                debugArtifactsEnabled: boolean;
            };

            expect(defaultPolicy.workspaceResolved).toBe(false);
            expect(defaultPolicy.contextId).toBeNull();
            expect(defaultPolicy.syncScope).toBe('workspace');
            expect(defaultPolicy.captureScope).toBe('machine');
            expect(defaultPolicy.debugScope).toBe('machine');
            expect(defaultPolicy.syncPolicy).toBe('metadata_only');
            expect(defaultPolicy.captureRetentionDays).toBe(14);
            expect(defaultPolicy.debugRetentionDays).toBe(7);
            expect(defaultPolicy.debugArtifactsEnabled).toBe(false);

            expect(resolvedPolicy.workspaceResolved).toBe(true);
            expect(resolvedPolicy.contextId).toBe(context.id);
            expect(resolvedPolicy.syncScope).toBe('workspace');
            expect(resolvedPolicy.captureScope).toBe('machine');
            expect(resolvedPolicy.debugScope).toBe('machine');
            expect(resolvedPolicy.syncPolicy).toBe('full_sync');
            expect(resolvedPolicy.captureRetentionDays).toBe(14);
            expect(resolvedPolicy.debugRetentionDays).toBe(7);
            expect(resolvedPolicy.debugArtifactsEnabled).toBe(false);
        } finally {
            db.close();
        }
    });

    it('returns repo readiness from the daemon using repo-bound workspace state', () => {
        const { db, graph } = createGraph();
        const previousUserProfile = process.env.USERPROFILE;
        const previousHome = process.env.HOME;
        const previousAppData = process.env.APPDATA;
        try {
            const session = handleRequest(graph, 'conn-repo-readiness', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const machineHome = mkdtempSync(path.join(os.tmpdir(), '0ctx-repo-readiness-home-'));
            const appData = path.join(machineHome, 'AppData', 'Roaming');
            const repoRoot = mkdtempSync(path.join(os.tmpdir(), '0ctx-repo-readiness-repo-'));
            tempDirs.push(machineHome, repoRoot);
            mkdirSync(path.join(repoRoot, '.0ctx'), { recursive: true });
            mkdirSync(path.join(repoRoot, '.claude'), { recursive: true });
            mkdirSync(path.join(repoRoot, '.factory'), { recursive: true });
            mkdirSync(path.join(repoRoot, '.gemini'), { recursive: true });
            mkdirSync(path.join(appData, 'Claude'), { recursive: true });
            mkdirSync(path.join(appData, 'Antigravity', 'User'), { recursive: true });

            process.env.USERPROFILE = machineHome;
            process.env.HOME = machineHome;
            process.env.APPDATA = appData;

            const context = handleRequest(graph, 'conn-repo-readiness', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'repo-readiness-context', paths: [repoRoot] }
            }, runtime()) as { id: string };

            const managedHooks = {
                projectRoot: repoRoot,
                contextId: context.id,
                hooks: [
                    { agent: 'claude', command: '0ctx connector hook ingest --quiet --agent=claude' },
                    { agent: 'factory', command: '0ctx connector hook ingest --quiet --agent=factory' },
                    { agent: 'antigravity', command: '0ctx connector hook ingest --quiet --agent=antigravity' }
                ]
            };
            writeFileSync(path.join(repoRoot, '.0ctx', 'settings.local.json'), JSON.stringify(managedHooks, null, 2));
            writeFileSync(path.join(repoRoot, '.claude', 'settings.local.json'), JSON.stringify({
                hooks: {
                    SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: '0ctx connector hook session-start --agent=claude' }] }],
                    Stop: [{ matcher: '', hooks: [{ type: 'command', command: '0ctx connector hook ingest --quiet --agent=claude' }] }],
                    SubagentStop: [{ matcher: '', hooks: [{ type: 'command', command: '0ctx connector hook ingest --quiet --agent=claude' }] }]
                }
            }, null, 2));
            writeFileSync(path.join(repoRoot, '.factory', 'settings.json'), JSON.stringify({
                hooks: {
                    SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: '0ctx connector hook session-start --agent=factory' }] }],
                    Stop: [{ matcher: '', hooks: [{ type: 'command', command: '0ctx connector hook ingest --quiet --agent=factory' }] }],
                    SubagentStop: [{ matcher: '', hooks: [{ type: 'command', command: '0ctx connector hook ingest --quiet --agent=factory' }] }]
                }
            }, null, 2));
            writeFileSync(path.join(repoRoot, '.gemini', 'settings.json'), JSON.stringify({
                hooks: {
                    SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: '0ctx connector hook session-start --agent=antigravity' }] }],
                    Stop: [{ matcher: '', hooks: [{ type: 'command', command: '0ctx connector hook ingest --quiet --agent=antigravity' }] }],
                    SubagentStop: [{ matcher: '', hooks: [{ type: 'command', command: '0ctx connector hook ingest --quiet --agent=antigravity' }] }]
                }
            }, null, 2));
            writeFileSync(path.join(appData, 'Claude', 'claude_desktop_config.json'), JSON.stringify({
                mcpServers: { '0ctx': { command: '0ctx', args: ['mcp'] } }
            }, null, 2));
            writeFileSync(path.join(appData, 'Antigravity', 'User', 'mcp.json'), JSON.stringify({
                mcpServers: { '0ctx': { command: '0ctx', args: ['mcp'] } }
            }, null, 2));

            const readiness = handleRequest(graph, 'conn-repo-readiness', {
                method: 'getRepoReadiness',
                sessionToken: session.sessionToken,
                params: { repoRoot }
            }, runtime()) as {
                repoRoot: string;
                contextId: string | null;
                workspaceName: string | null;
                syncPolicy: string | null;
                captureReadyAgents: string[];
                autoContextAgents: string[];
                zeroTouchReady: boolean;
                nextActionHint: string | null;
                dataPolicyPreset: string | null;
            };

            expect(path.resolve(readiness.repoRoot)).toBe(path.resolve(repoRoot));
            expect(readiness.contextId).toBe(context.id);
            expect(readiness.workspaceName).toBe('repo-readiness-context');
            expect(readiness.syncPolicy).toBe('metadata_only');
            expect(readiness.captureReadyAgents).toEqual(['claude', 'factory', 'antigravity']);
            expect(readiness.autoContextAgents).toEqual(['claude', 'factory', 'antigravity']);
            expect(readiness.zeroTouchReady).toBe(true);
            expect(readiness.nextActionHint).toBeNull();
            expect(readiness.dataPolicyPreset).toBe('lean');
        } finally {
            if (previousUserProfile === undefined) delete process.env.USERPROFILE;
            else process.env.USERPROFILE = previousUserProfile;
            if (previousHome === undefined) delete process.env.HOME;
            else process.env.HOME = previousHome;
            if (previousAppData === undefined) delete process.env.APPDATA;
            else process.env.APPDATA = previousAppData;
            db.close();
        }
    });

    it('keeps zero-touch readiness false until MCP retrieval is registered for agents that require it', () => {
        const { db, graph } = createGraph();
        const previousUserProfile = process.env.USERPROFILE;
        const previousHome = process.env.HOME;
        const previousAppData = process.env.APPDATA;
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'repo-readiness-mcp-optional-'));
        const repoRoot = path.join(tempRoot, 'repo');

        try {
            process.env.USERPROFILE = tempRoot;
            process.env.HOME = tempRoot;
            process.env.APPDATA = path.join(tempRoot, 'AppData', 'Roaming');

            mkdirSync(repoRoot, { recursive: true });
            mkdirSync(path.join(repoRoot, '.0ctx'), { recursive: true });
            mkdirSync(path.join(repoRoot, '.claude'), { recursive: true });
            execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
            execFileSync('git', ['config', 'user.name', '0ctx Test'], { cwd: repoRoot, stdio: 'ignore' });
            execFileSync('git', ['config', 'user.email', 'tests@0ctx.local'], { cwd: repoRoot, stdio: 'ignore' });
            writeFileSync(path.join(repoRoot, 'README.md'), '# repo');
            execFileSync('git', ['add', 'README.md'], { cwd: repoRoot, stdio: 'ignore' });
            execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, stdio: 'ignore' });

            const session = handleRequest(graph, 'conn-repo-readiness-mcp-optional', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-repo-readiness-mcp-optional', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'repo-readiness-mcp-optional', paths: [repoRoot] }
            }, runtime()) as { id: string };

            writeFileSync(path.join(repoRoot, '.0ctx', 'settings.local.json'), JSON.stringify({
                version: 1,
                generatedAt: Date.now(),
                projectRoot: repoRoot,
                contextId: context.id,
                hooks: [
                    {
                        agent: 'claude',
                        command: '0ctx connector hook ingest --quiet --agent=claude',
                        mode: 'post-chat'
                    }
                ]
            }, null, 2));
            writeFileSync(path.join(repoRoot, '.claude', 'settings.local.json'), JSON.stringify({
                hooks: {
                    SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: '0ctx connector hook session-start --agent=claude' }] }],
                    Stop: [{ matcher: '', hooks: [{ type: 'command', command: '0ctx connector hook ingest --quiet --agent=claude' }] }],
                    SubagentStop: [{ matcher: '', hooks: [{ type: 'command', command: '0ctx connector hook ingest --quiet --agent=claude' }] }]
                }
            }, null, 2));

            const readiness = handleRequest(graph, 'conn-repo-readiness-mcp-optional', {
                method: 'getRepoReadiness',
                sessionToken: session.sessionToken,
                params: { repoRoot }
            }, runtime()) as {
                autoContextAgents: string[];
                autoContextMissingAgents: string[];
                mcpRegistrationMissingAgents: string[];
                zeroTouchReady: boolean;
                nextActionHint: string | null;
            };

            expect(context.id).toBeTruthy();
            expect(readiness.autoContextAgents).toEqual([]);
            expect(readiness.autoContextMissingAgents).toEqual(['claude']);
            expect(readiness.mcpRegistrationMissingAgents).toEqual(['claude']);
            expect(readiness.zeroTouchReady).toBe(false);
            expect(readiness.nextActionHint).toContain('Complete one-time context setup for claude');
        } finally {
            if (previousUserProfile === undefined) delete process.env.USERPROFILE;
            else process.env.USERPROFILE = previousUserProfile;
            if (previousHome === undefined) delete process.env.HOME;
            else process.env.HOME = previousHome;
            if (previousAppData === undefined) delete process.env.APPDATA;
            else process.env.APPDATA = previousAppData;
            db.close();
        }
    });

    it('updates data policy through the daemon and persists capture config safely', () => {
        const { db, graph } = createGraph();
        const previousConfigPath = process.env.CTX_CONFIG_PATH;
        const configPath = path.join(path.dirname(db.name), 'config.json');
        try {
            process.env.CTX_CONFIG_PATH = configPath;
            const session = handleRequest(graph, 'conn-set-data-policy', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-set-data-policy', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'set-data-policy-context' }
            }, runtime()) as { id: string };

            const result = handleRequest(graph, 'conn-set-data-policy', {
                method: 'setDataPolicy',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    syncPolicy: 'full_sync',
                    captureRetentionDays: 21,
                    debugRetentionDays: 5,
                    debugArtifactsEnabled: true
                }
            }, runtime()) as {
                contextId: string | null;
                syncScope: string;
                captureScope: string;
                debugScope: string;
                syncPolicy: string;
                captureRetentionDays: number;
                debugRetentionDays: number;
                debugArtifactsEnabled: boolean;
            };

            const storedConfig = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
            const audits = graph.listAuditEvents(context.id, 20);

            expect(result.contextId).toBe(context.id);
            expect(result.syncScope).toBe('workspace');
            expect(result.captureScope).toBe('machine');
            expect(result.debugScope).toBe('machine');
            expect(result.syncPolicy).toBe('full_sync');
            expect(result.captureRetentionDays).toBe(21);
            expect(result.debugRetentionDays).toBe(5);
            expect(result.debugArtifactsEnabled).toBe(true);
            expect(storedConfig['capture.retentionDays']).toBe(21);
            expect(storedConfig['capture.debugRetentionDays']).toBe(5);
            expect(storedConfig['capture.debugArtifacts']).toBe(true);
            expect(audits.some((entry) => entry.action === 'set_data_policy')).toBe(true);
        } finally {
            if (previousConfigPath === undefined) {
                delete process.env.CTX_CONFIG_PATH;
            } else {
                process.env.CTX_CONFIG_PATH = previousConfigPath;
            }
            db.close();
        }
    });

    it('applies supported data policy presets through the daemon', () => {
        const { db, graph } = createGraph();
        const previousConfigPath = process.env.CTX_CONFIG_PATH;
        const configPath = path.join(path.dirname(db.name), 'config.json');
        try {
            process.env.CTX_CONFIG_PATH = configPath;
            const session = handleRequest(graph, 'conn-preset-data-policy', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-preset-data-policy', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'preset-data-policy-context' }
            }, runtime()) as { id: string };

            const debugPolicy = handleRequest(graph, 'conn-preset-data-policy', {
                method: 'setDataPolicy',
                sessionToken: session.sessionToken,
                params: { preset: 'debug' }
            }, runtime()) as {
                syncScope: string;
                captureScope: string;
                debugScope: string;
                syncPolicy: string;
                captureRetentionDays: number;
                debugRetentionDays: number;
                debugArtifactsEnabled: boolean;
                preset: string;
            };

            const sharedPolicy = handleRequest(graph, 'conn-preset-data-policy', {
                method: 'setDataPolicy',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, preset: 'shared' }
            }, runtime()) as {
                contextId: string | null;
                syncScope: string;
                captureScope: string;
                debugScope: string;
                syncPolicy: string;
                captureRetentionDays: number;
                debugRetentionDays: number;
                debugArtifactsEnabled: boolean;
                preset: string;
            };

            expect(debugPolicy.syncPolicy).toBe('metadata_only');
            expect(debugPolicy.syncScope).toBe('workspace');
            expect(debugPolicy.captureScope).toBe('machine');
            expect(debugPolicy.debugScope).toBe('machine');
            expect(debugPolicy.captureRetentionDays).toBe(30);
            expect(debugPolicy.debugRetentionDays).toBe(14);
            expect(debugPolicy.debugArtifactsEnabled).toBe(true);
            expect(debugPolicy.preset).toBe('debug');

            expect(sharedPolicy.contextId).toBe(context.id);
            expect(sharedPolicy.syncScope).toBe('workspace');
            expect(sharedPolicy.captureScope).toBe('machine');
            expect(sharedPolicy.debugScope).toBe('machine');
            expect(sharedPolicy.syncPolicy).toBe('full_sync');
            expect(sharedPolicy.captureRetentionDays).toBe(14);
            expect(sharedPolicy.debugRetentionDays).toBe(7);
            expect(sharedPolicy.debugArtifactsEnabled).toBe(false);
            expect(sharedPolicy.preset).toBe('shared');
        } finally {
            if (previousConfigPath === undefined) {
                delete process.env.CTX_CONFIG_PATH;
            } else {
                process.env.CTX_CONFIG_PATH = previousConfigPath;
            }
            db.close();
        }
    });
    it('defaults new contexts to metadata_only sync', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-sync-default', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-sync-default', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'default-sync-policy-context' }
            }, runtime()) as { id: string; syncPolicy: string };

            const current = handleRequest(graph, 'conn-sync-default', {
                method: 'getSyncPolicy',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as { syncPolicy: string };

            expect(context.syncPolicy).toBe('metadata_only');
            expect(current.syncPolicy).toBe('metadata_only');
        } finally {
            db.close();
        }
    });

    it('lists chat sessions/turns and keeps hidden nodes out of default graph data', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-chat', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-chat', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'chat-context' }
            }, runtime()) as { id: string };

            const visible = handleRequest(graph, 'conn-chat', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, type: 'artifact', content: 'visible node' }
            }, runtime()) as { id: string };

            const hiddenTurn = handleRequest(graph, 'conn-chat', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    type: 'artifact',
                    hidden: true,
                    thread: 'session-1',
                    key: 'chat_turn:codex:session-1:turn-1',
                    content: 'chat turn summary',
                    tags: ['chat_turn', 'role:assistant'],
                    rawPayload: {
                        role: 'assistant',
                        branch: 'main',
                        commitSha: 'abc123'
                    }
                }
            }, runtime()) as { id: string };

            const graphDefault = handleRequest(graph, 'conn-chat', {
                method: 'getGraphData',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as { nodes: Array<{ id: string }> };
            expect(graphDefault.nodes.map(node => node.id)).toContain(visible.id);
            expect(graphDefault.nodes.map(node => node.id)).not.toContain(hiddenTurn.id);

            const graphWithHidden = handleRequest(graph, 'conn-chat', {
                method: 'getGraphData',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, includeHidden: true }
            }, runtime()) as { nodes: Array<{ id: string }> };
            expect(graphWithHidden.nodes.map(node => node.id)).toContain(hiddenTurn.id);

            const byKeyDefault = handleRequest(graph, 'conn-chat', {
                method: 'getByKey',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, key: 'chat_turn:codex:session-1:turn-1' }
            }, runtime()) as { id?: string } | null;
            expect(byKeyDefault).toBeNull();

            const byKeyWithHidden = handleRequest(graph, 'conn-chat', {
                method: 'getByKey',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, key: 'chat_turn:codex:session-1:turn-1', includeHidden: true }
            }, runtime()) as { id?: string } | null;
            expect(byKeyWithHidden?.id).toBe(hiddenTurn.id);

            const sessions = handleRequest(graph, 'conn-chat', {
                method: 'listChatSessions',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as Array<{ sessionId: string; turnCount: number }>;
            expect(sessions).toHaveLength(1);
            expect(sessions[0].sessionId).toBe('session-1');
            expect(sessions[0].turnCount).toBe(1);

            const turns = handleRequest(graph, 'conn-chat', {
                method: 'listChatTurns',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, sessionId: 'session-1' }
            }, runtime()) as Array<{ nodeId: string; hasPayload: boolean }>;
            expect(turns).toHaveLength(1);
            expect(turns[0].nodeId).toBe(hiddenTurn.id);
            expect(turns[0].hasPayload).toBe(true);

            const payload = handleRequest(graph, 'conn-chat', {
                method: 'getNodePayload',
                sessionToken: session.sessionToken,
                params: { nodeId: hiddenTurn.id }
            }, runtime()) as { payload: Record<string, unknown> };
            expect(payload.payload.commitSha).toBe('abc123');
        } finally {
            db.close();
        }
    });

    it('serves branch lanes, session messages, and checkpoint workflows', { timeout: 10000 }, () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-branch', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-branch', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'branch-context' }
            }, runtime()) as { id: string };

            handleRequest(graph, 'conn-branch', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    type: 'artifact',
                    hidden: true,
                    thread: 'session-branch-1',
                    key: 'chat_session:factory:session-branch-1',
                    content: 'branch lane summary -> checkpoint ready',
                    tags: ['chat_session', 'agent:factory'],
                    rawPayload: {
                        sessionId: 'session-branch-1',
                        branch: 'feature/branch-lane',
                        commitSha: 'abc123def456',
                        agent: 'factory',
                        worktreePath: 'C:/repo',
                        repositoryRoot: 'C:/repo'
                    }
                }
            }, runtime());

            handleRequest(graph, 'conn-branch', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    type: 'artifact',
                    hidden: true,
                    thread: 'session-branch-1',
                    key: 'chat_turn:factory:session-branch-1:msg-1',
                    content: 'checkpoint ready',
                    tags: ['chat_turn', 'role:assistant'],
                    rawPayload: {
                        sessionId: 'session-branch-1',
                        messageId: 'msg-1',
                        role: 'assistant',
                        branch: 'feature/branch-lane',
                        commitSha: 'abc123def456',
                        agent: 'factory',
                        worktreePath: 'C:/repo',
                        repositoryRoot: 'C:/repo',
                        occurredAt: 1700000003000
                    }
                }
            }, runtime());

            const lanes = handleRequest(graph, 'conn-branch', {
                method: 'listBranchLanes',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as Array<{
                branch: string;
                lastAgent: string | null;
                sessionCount: number;
                handoffReadiness?: 'ready' | 'review' | 'blocked';
                handoffSummary?: string | null;
            }>;
            expect(lanes).toHaveLength(1);
            expect(lanes[0].branch).toBe('feature/branch-lane');
            expect(lanes[0].lastAgent).toBe('factory');
            expect(lanes[0].sessionCount).toBe(1);
            expect(lanes[0].handoffReadiness).toBe('review');
            expect(lanes[0].handoffSummary).toContain('local-only workstream has no baseline and no checkpoint coverage');

            const brief = handleRequest(graph, 'conn-branch', {
                method: 'getWorkstreamBrief',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    branch: 'feature/branch-lane',
                    worktreePath: 'C:/repo'
                }
            }, runtime()) as {
                workspaceName: string;
                branch: string | null;
                tracked: boolean;
                handoffReadiness?: 'ready' | 'review' | 'blocked';
                handoffSummary?: string | null;
                recentSessions: Array<{ sessionId: string }>;
                contextText: string;
            };
            expect(brief.workspaceName).toBe('branch-context');
            expect(brief.branch).toBe('feature/branch-lane');
            expect(brief.tracked).toBe(true);
            expect(brief.handoffReadiness).toBe('review');
            expect(brief.handoffSummary).toContain('local-only workstream has no baseline and no checkpoint coverage');
            expect(brief.handoffBlockers).toEqual([]);
            expect(brief.handoffReviewItems).toContain('This workstream has no upstream or baseline.');
            expect(brief.handoffReviewItems).toContain('Create a checkpoint before handoff.');
            expect(brief.recentSessions[0]?.sessionId).toBe('session-branch-1');
            expect(brief.contextText).toContain('Current workstream: feature/branch-lane');
            expect(brief.contextText).toContain('Handoff: Review before handoff.');
            expect(brief.contextText).toContain('Review:');

            const agentContext = handleRequest(graph, 'conn-branch', {
                method: 'getAgentContextPack',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    branch: 'feature/branch-lane',
                    worktreePath: 'C:/repo'
                }
            }, runtime()) as {
                workspaceName: string;
                branch: string | null;
                workstream: {
                    handoffReadiness?: 'ready' | 'review' | 'blocked';
                    handoffSummary?: string | null;
                };
                recentSessions: Array<{ sessionId: string }>;
                latestCheckpoints: Array<unknown>;
                handoffTimeline: Array<{ sessionId: string }>;
                promptText: string;
            };
            expect(agentContext.workspaceName).toBe('branch-context');
            expect(agentContext.branch).toBe('feature/branch-lane');
            expect(agentContext.workstream.handoffReadiness).toBe('review');
            expect(agentContext.workstream.handoffSummary).toContain('local-only workstream has no baseline and no checkpoint coverage');
            expect(agentContext.recentSessions[0]?.sessionId).toBe('session-branch-1');
            expect(agentContext.latestCheckpoints).toHaveLength(0);
            expect(agentContext.handoffTimeline[0]?.sessionId).toBe('session-branch-1');
            expect(agentContext.promptText).toContain('0ctx workstream context');
            expect(agentContext.promptText).toContain('Workspace: branch-context');
            expect(agentContext.promptText).toContain('Workstream: feature/branch-lane');
            expect(agentContext.promptText).toContain('Recent sessions:');
            expect(agentContext.promptText).toContain('Recent handoffs:');
            expect(agentContext.promptText).toContain('Handoff: Review before handoff.');

            const sessions = handleRequest(graph, 'conn-branch', {
                method: 'listBranchSessions',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, branch: 'feature/branch-lane', worktreePath: 'C:/repo' }
            }, runtime()) as Array<{ sessionId: string }>;
            expect(sessions).toHaveLength(1);
            expect(sessions[0].sessionId).toBe('session-branch-1');

            const messages = handleRequest(graph, 'conn-branch', {
                method: 'listSessionMessages',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, sessionId: 'session-branch-1' }
            }, runtime()) as Array<{ messageId?: string; agent?: string | null }>;
            expect(messages).toHaveLength(1);
            expect(messages[0].messageId).toBe('msg-1');
            expect(messages[0].agent).toBe('factory');

            const checkpoint = handleRequest(graph, 'conn-branch', {
                method: 'createSessionCheckpoint',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, sessionId: 'session-branch-1', summary: 'checkpoint summary' }
            }, runtime()) as { id: string; sessionId: string | null; branch: string | null };
            expect(checkpoint.sessionId).toBe('session-branch-1');
            expect(checkpoint.branch).toBe('feature/branch-lane');

            const checkpointDetail = handleRequest(graph, 'conn-branch', {
                method: 'getCheckpointDetail',
                sessionToken: session.sessionToken,
                params: { checkpointId: checkpoint.id }
            }, runtime()) as { checkpoint: { id: string }; payloadAvailable: boolean };
            expect(checkpointDetail.checkpoint.id).toBe(checkpoint.id);
            expect(checkpointDetail.payloadAvailable).toBe(true);

            const explain = handleRequest(graph, 'conn-branch', {
                method: 'explainCheckpoint',
                sessionToken: session.sessionToken,
                params: { checkpointId: checkpoint.id }
            }, runtime()) as { checkpoint: { id: string } };
            expect(explain.checkpoint.id).toBe(checkpoint.id);

            const handoff = handleRequest(graph, 'conn-branch', {
                method: 'getHandoffTimeline',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, branch: 'feature/branch-lane', worktreePath: 'C:/repo' }
            }, runtime()) as Array<{ sessionId: string }>;
            expect(handoff).toHaveLength(1);
            expect(handoff[0].sessionId).toBe('session-branch-1');

            handleRequest(graph, 'conn-branch', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, type: 'assumption', content: 'remove on rewind' }
            }, runtime());

            const rewind = handleRequest(graph, 'conn-branch', {
                method: 'rewindCheckpoint',
                sessionToken: session.sessionToken,
                params: { checkpointId: checkpoint.id }
            }, runtime()) as { checkpoint: { id: string } };
            expect(rewind.checkpoint.id).toBe(checkpoint.id);

            const resume = handleRequest(graph, 'conn-branch', {
                method: 'resumeSession',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, sessionId: 'session-branch-1' }
            }, runtime()) as { session: { sessionId: string } | null; checkpointCount: number };
            expect(resume.session?.sessionId).toBe('session-branch-1');
            expect(resume.checkpointCount).toBeGreaterThanOrEqual(1);

            const audit = handleRequest(graph, 'conn-branch', {
                method: 'listAuditEvents',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, limit: 20 }
            }, runtime()) as Array<{ action: string }>;

            expect(audit.some(event => event.action === 'save_checkpoint')).toBe(true);
            expect(audit.some(event => event.action === 'rewind')).toBe(true);
            expect(audit.some(event => event.action === 'resume_session')).toBe(true);
            expect(audit.some(event => event.action === 'explain_checkpoint')).toBe(true);
        } finally {
            db.close();
        }
    });

    it('enriches workstreams with git-aware state when the repository exists locally', () => {
        if (!gitAvailable()) return;
        const { db, graph } = createGraph();
        try {
            const repoRoot = path.join(os.tmpdir(), `0ctx-workstream-repo-${Date.now()}`);
            tempDirs.push(repoRoot);
            spawnSync('git', ['init', '--initial-branch', 'main', repoRoot], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.name', '0ctx test'], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'notes.txt')}' -Value 'base'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'add', '.'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'commit', '-m', 'base'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'checkout', '-b', 'feature/runtime-shape'], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'notes.txt')}' -Value 'feature'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'add', '.'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'commit', '-m', 'feature'], { encoding: 'utf8', windowsHide: true });
            const featureHead = String(spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).stdout ?? '').trim();
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'staged.txt')}' -Value 'staged change'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'add', 'staged.txt'], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Add-Content -Path '${path.join(repoRoot, 'staged.txt')}' -Value 'unstaged change'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'draft.txt')}' -Value 'untracked change'`], { encoding: 'utf8', windowsHide: true });

            const session = handleRequest(graph, 'conn-git', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-git', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'git-aware-context', paths: [repoRoot] }
            }, runtime()) as { id: string };

            handleRequest(graph, 'conn-git', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    type: 'artifact',
                    hidden: true,
                    thread: 'session-git-1',
                    key: 'chat_session:claude:session-git-1',
                    content: 'git aware session summary',
                    tags: ['chat_session', 'agent:claude'],
                    rawPayload: {
                        sessionId: 'session-git-1',
                        branch: 'feature/runtime-shape',
                        commitSha: featureHead,
                        agent: 'claude',
                        worktreePath: repoRoot,
                        repositoryRoot: repoRoot
                    }
                }
            }, runtime());

            handleRequest(graph, 'conn-git', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    type: 'artifact',
                    hidden: true,
                    thread: 'session-git-1',
                    key: 'chat_turn:claude:session-git-1:msg-1',
                    content: 'git aware captured turn',
                    tags: ['chat_turn', 'role:assistant'],
                    rawPayload: {
                        sessionId: 'session-git-1',
                        messageId: 'msg-1',
                        role: 'assistant',
                        branch: 'feature/runtime-shape',
                        commitSha: featureHead,
                        agent: 'claude',
                        worktreePath: repoRoot,
                        repositoryRoot: repoRoot,
                        occurredAt: Date.now()
                    }
                }
            }, runtime());

            graph.addNode({
                contextId: context.id,
                type: 'decision',
                content: 'Keep reviewed insights scoped to the current workstream.',
                key: 'knowledge:decision:feature-runtime-shape',
                tags: ['knowledge', 'derived', 'branch:feature/runtime-shape', `worktree:${repoRoot}`],
                source: 'extractor:session',
                hidden: false
            });

            const lanes = handleRequest(graph, 'conn-git', {
                method: 'listBranchLanes',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as Array<{
                branch: string;
                repositoryRoot: string | null;
                currentHeadSha: string | null;
                currentHeadRef: string | null;
                isDetachedHead: boolean | null;
                headDiffersFromCaptured: boolean | null;
                isCurrent: boolean | null;
                checkedOutWorktreePaths: string[];
                checkedOutHere: boolean | null;
                checkedOutElsewhere: boolean | null;
                upstream: string | null;
                hasUncommittedChanges: boolean | null;
                hasMergeConflicts?: boolean | null;
                unmergedCount?: number | null;
                stagedChangeCount: number | null;
                unstagedChangeCount: number | null;
                untrackedCount: number | null;
                baseline: { branch: string | null; aheadCount: number | null; behindCount: number | null; summary: string } | null;
            }>;

            expect(lanes).toHaveLength(1);
            expect(lanes[0].branch).toBe('feature/runtime-shape');
            expect(lanes[0].repositoryRoot).toBe(repoRoot);
            expect(lanes[0].currentHeadSha).toBe(featureHead);
            expect(lanes[0].currentHeadRef).toBe('refs/heads/feature/runtime-shape');
            expect(lanes[0].isDetachedHead).toBe(false);
            expect(lanes[0].headDiffersFromCaptured).toBe(false);
            expect(lanes[0].isCurrent).toBe(true);
            expect(lanes[0].checkedOutHere).toBe(true);
            expect(lanes[0].checkedOutElsewhere).toBe(false);
            expect(lanes[0].checkedOutWorktreePaths.map(item => path.resolve(item))).toContain(path.resolve(repoRoot));
            expect(lanes[0].upstream).toBeNull();
            expect(lanes[0].hasUncommittedChanges).toBe(true);
            expect(lanes[0].hasMergeConflicts).toBe(false);
            expect(lanes[0].unmergedCount).toBe(0);
            expect(lanes[0].stagedChangeCount).toBeGreaterThanOrEqual(1);
            expect(lanes[0].unstagedChangeCount).toBe(1);
            expect(lanes[0].untrackedCount).toBe(1);
            expect(lanes[0].baseline?.branch).toBe('main');
            expect(lanes[0].baseline?.aheadCount).toBe(1);
            expect(lanes[0].baseline?.behindCount).toBe(0);
            expect(lanes[0].baseline?.summary).toContain('ahead of main');

            const brief = handleRequest(graph, 'conn-git', {
                method: 'getWorkstreamBrief',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    branch: 'feature/runtime-shape',
                    worktreePath: repoRoot
                }
            }, runtime()) as {
                repositoryRoot: string | null;
                currentHeadSha: string | null;
                currentHeadRef: string | null;
                isDetachedHead: boolean | null;
                headDiffersFromCaptured: boolean | null;
                isCurrent: boolean | null;
                checkedOutWorktreePaths: string[];
                checkedOutHere: boolean | null;
                checkedOutElsewhere: boolean | null;
                hasUncommittedChanges: boolean | null;
                hasMergeConflicts?: boolean | null;
                unmergedCount?: number | null;
                stagedChangeCount: number | null;
                unstagedChangeCount: number | null;
                untrackedCount: number | null;
                stateKind: string | null;
                stateSummary: string | null;
                stateActionHint: string | null;
                baseline: { branch: string | null; aheadCount: number | null; behindCount: number | null; summary: string } | null;
                handoffReadiness?: 'ready' | 'review' | 'blocked';
                handoffSummary?: string | null;
                insights: Array<{ type: string; content: string }>;
                contextText: string;
            };

            expect(brief.repositoryRoot).toBe(repoRoot);
            expect(brief.currentHeadSha).toBe(featureHead);
            expect(brief.currentHeadRef).toBe('refs/heads/feature/runtime-shape');
            expect(brief.isDetachedHead).toBe(false);
            expect(brief.headDiffersFromCaptured).toBe(false);
            expect(brief.isCurrent).toBe(true);
            expect(brief.checkedOutHere).toBe(true);
            expect(brief.checkedOutElsewhere).toBe(false);
            expect(brief.checkedOutWorktreePaths.map(item => path.resolve(item))).toContain(path.resolve(repoRoot));
            expect(brief.hasUncommittedChanges).toBe(true);
            expect(brief.hasMergeConflicts).toBe(false);
            expect(brief.unmergedCount).toBe(0);
            expect(brief.stagedChangeCount).toBeGreaterThanOrEqual(1);
            expect(brief.unstagedChangeCount).toBe(1);
            expect(brief.untrackedCount).toBe(1);
            expect(brief.stateKind).toBe('dirty');
            expect(brief.stateSummary).toContain('Working tree has local uncommitted changes');
            expect(brief.stateActionHint).toContain('Commit or checkpoint local changes');
            expect(brief.handoffReadiness).toBe('review');
            expect(brief.handoffSummary).toContain('Review git state before handoff');
            expect(brief.baseline?.branch).toBe('main');
            expect(brief.baseline?.aheadCount).toBe(1);
            expect(brief.baseline?.behindCount).toBe(0);
            expect(brief.baseline?.summary).toContain('ahead of main');
            expect(brief.insights).toHaveLength(1);
            expect(brief.insights[0]?.type).toBe('decision');
            expect(brief.insights[0]?.content).toContain('current workstream');
            expect(brief.contextText).toContain('Status: Working tree has local uncommitted changes.');
            expect(brief.contextText).toContain('Recommended next step: Commit or checkpoint local changes before handing this workstream to another agent.');
            expect(brief.contextText).toContain('Handoff: Review git state before handoff.');
            expect(brief.contextText).toContain('Checkout: this workstream is checked out here.');
            expect(brief.contextText).toContain('Baseline: feature/runtime-shape is 1 commit ahead of main.');
            expect(brief.contextText).toContain('Local changes:');
            expect(brief.contextText).toContain('staged');
            expect(brief.contextText).toContain('1 unstaged');
            expect(brief.contextText).toContain('1 untracked');
            expect(brief.contextText).toContain('Reviewed insights:');

            const pack = handleRequest(graph, 'conn-git', {
                method: 'getAgentContextPack',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    branch: 'feature/runtime-shape',
                    worktreePath: repoRoot
                }
            }, runtime()) as {
                workstream: {
                    currentHeadSha: string | null;
                    currentHeadRef: string | null;
                    isDetachedHead: boolean | null;
                    headDiffersFromCaptured: boolean | null;
                    checkedOutWorktreePaths: string[];
                    checkedOutHere: boolean | null;
                    checkedOutElsewhere: boolean | null;
                    hasUncommittedChanges: boolean | null;
                    hasMergeConflicts?: boolean | null;
                    unmergedCount?: number | null;
                    stagedChangeCount: number | null;
                    unstagedChangeCount: number | null;
                    untrackedCount: number | null;
                    stateKind: string | null;
                    stateSummary: string | null;
                    stateActionHint: string | null;
                    handoffReadiness?: 'ready' | 'review' | 'blocked';
                    handoffSummary?: string | null;
                };
                baseline: { branch: string | null; aheadCount: number | null; behindCount: number | null; summary: string } | null;
                insights: Array<{ type: string; content: string }>;
                promptText: string;
            };

            expect(pack.baseline?.branch).toBe('main');
            expect(pack.baseline?.aheadCount).toBe(1);
            expect(pack.workstream.currentHeadSha).toBe(featureHead);
            expect(pack.workstream.currentHeadRef).toBe('refs/heads/feature/runtime-shape');
            expect(pack.workstream.isDetachedHead).toBe(false);
            expect(pack.workstream.headDiffersFromCaptured).toBe(false);
            expect(pack.workstream.checkedOutHere).toBe(true);
            expect(pack.workstream.checkedOutElsewhere).toBe(false);
            expect(pack.workstream.checkedOutWorktreePaths.map(item => path.resolve(item))).toContain(path.resolve(repoRoot));
            expect(pack.workstream.hasUncommittedChanges).toBe(true);
            expect(pack.workstream.hasMergeConflicts).toBe(false);
            expect(pack.workstream.unmergedCount).toBe(0);
            expect(pack.workstream.stagedChangeCount).toBeGreaterThanOrEqual(1);
            expect(pack.workstream.unstagedChangeCount).toBe(1);
            expect(pack.workstream.untrackedCount).toBe(1);
            expect(pack.workstream.stateKind).toBe('dirty');
            expect(pack.workstream.stateSummary).toContain('Working tree has local uncommitted changes');
            expect(pack.workstream.stateActionHint).toContain('Commit or checkpoint local changes');
            expect(pack.workstream.handoffReadiness).toBe('review');
            expect(pack.workstream.handoffSummary).toContain('Review git state before handoff');
            expect(pack.insights).toHaveLength(1);
            expect(pack.insights[0]?.type).toBe('decision');
            expect(pack.promptText).toContain('0ctx workstream context');
            expect(pack.promptText).toContain('Workspace: git-aware-context');
            expect(pack.promptText).toContain('Workstream: feature/runtime-shape');
            expect(pack.promptText).toContain('State: Working tree has local uncommitted changes.');
            expect(pack.promptText).toContain('Next: Commit or checkpoint local changes before handing this workstream to another agent.');
            expect(pack.promptText).toContain('Handoff: Review git state before handoff.');
            expect(pack.promptText).toContain('Recent sessions:');
            expect(pack.promptText).toContain('Reviewed insights:');

            const insights = handleRequest(graph, 'conn-git', {
                method: 'listWorkstreamInsights',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    branch: 'feature/runtime-shape',
                    worktreePath: repoRoot
                }
            }, runtime()) as Array<{ type: string; content: string }>;

            expect(insights).toHaveLength(1);
            expect(insights[0]?.type).toBe('decision');

            const inferredBrief = handleRequest(graph, 'conn-git', {
                method: 'getWorkstreamBrief',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id
                }
            }, runtime()) as {
                branch: string | null;
                worktreePath: string | null;
                baseline: { branch: string | null; aheadCount: number | null; behindCount: number | null; summary: string } | null;
            };

            expect(inferredBrief.branch).toBe('feature/runtime-shape');
            expect(path.resolve(String(inferredBrief.worktreePath))).toBe(path.resolve(repoRoot));
            expect(inferredBrief.baseline?.branch).toBe('main');

            const inferredPack = handleRequest(graph, 'conn-git', {
                method: 'getAgentContextPack',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id
                }
            }, runtime()) as {
                branch: string | null;
                workstream: { branch: string | null };
                baseline: { branch: string | null } | null;
            };

            expect(inferredPack.branch).toBe('feature/runtime-shape');
            expect(inferredPack.workstream.branch).toBe('feature/runtime-shape');
            expect(inferredPack.baseline?.branch).toBe('main');
        } finally {
            db.close();
        }
    }, 15000);

    it('represents unresolved merge conflicts as a blocked workstream state', () => {
        const { db, graph } = createGraph();
        const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'ctx-workstream-conflicted-'));

        try {
            execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
            execFileSync('git', ['config', 'user.name', '0ctx Test'], { cwd: repoRoot, stdio: 'ignore' });
            execFileSync('git', ['config', 'user.email', 'tests@0ctx.local'], { cwd: repoRoot, stdio: 'ignore' });

            const conflictFile = path.join(repoRoot, 'conflict.txt');
            writeFileSync(conflictFile, 'base\n');
            execFileSync('git', ['add', 'conflict.txt'], { cwd: repoRoot, stdio: 'ignore' });
            execFileSync('git', ['commit', '-m', 'base'], { cwd: repoRoot, stdio: 'ignore' });

            execFileSync('git', ['checkout', '-b', 'feature/conflicted'], { cwd: repoRoot, stdio: 'ignore' });
            writeFileSync(conflictFile, 'feature\n');
            execFileSync('git', ['add', 'conflict.txt'], { cwd: repoRoot, stdio: 'ignore' });
            execFileSync('git', ['commit', '-m', 'feature change'], { cwd: repoRoot, stdio: 'ignore' });

            execFileSync('git', ['checkout', 'master'], { cwd: repoRoot, stdio: 'ignore' });
            writeFileSync(conflictFile, 'main\n');
            execFileSync('git', ['add', 'conflict.txt'], { cwd: repoRoot, stdio: 'ignore' });
            execFileSync('git', ['commit', '-m', 'main change'], { cwd: repoRoot, stdio: 'ignore' });

            let mergeFailed = false;
            try {
                execFileSync('git', ['merge', 'feature/conflicted'], { cwd: repoRoot, stdio: 'ignore' });
            } catch {
                mergeFailed = true;
            }
            expect(mergeFailed).toBe(true);

            const session = handleRequest(graph, 'conn-workstream-conflicted', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-workstream-conflicted', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'conflicted-context', paths: [repoRoot] }
            }, runtime()) as { id: string };

            graph.addNode({
                contextId: context.id,
                type: 'artifact',
                key: 'chat_session:claude:conflicted-session',
                content: 'Conflicted workstream session',
                metadata: {
                    artifactType: 'chat_session',
                    agent: 'claude',
                    sessionId: 'conflicted-session',
                    branch: 'master',
                    worktreePath: repoRoot,
                    summary: 'conflicted workstream'
                },
                hidden: true
            });

            graph.addNode({
                contextId: context.id,
                type: 'artifact',
                key: 'chat_turn:claude:conflicted-session:msg-1',
                content: 'Resolve the merge conflict.',
                metadata: {
                    artifactType: 'chat_turn',
                    agent: 'claude',
                    sessionId: 'conflicted-session',
                    messageId: 'msg-1',
                    role: 'assistant',
                    branch: 'master',
                    worktreePath: repoRoot,
                    occurredAt: Date.now()
                },
                hidden: true
            });

            const brief = handleRequest(graph, 'conn-workstream-conflicted', {
                method: 'getWorkstreamBrief',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, branch: 'master' }
            }, runtime()) as any;

            expect(brief.branch).toBe('master');
            expect(brief.hasUncommittedChanges).toBe(true);
            expect(brief.hasMergeConflicts).toBe(true);
            expect(brief.unmergedCount).toBeGreaterThanOrEqual(1);
            expect(brief.stateKind).toBe('conflicted');
            expect(brief.stateSummary).toContain('unmerged');
            expect(brief.stateActionHint).toContain('Resolve merge conflicts');
            expect(brief.handoffReadiness).toBe('blocked');
            expect(brief.handoffSummary).toContain('Resolve merge conflicts');
            expect(brief.handoffBlockers).toContain('This workstream has unresolved merge conflicts.');
            expect(brief.contextText).toContain('Status: Working tree has');
            expect(brief.contextText).toContain('Recommended next step: Resolve merge conflicts');
            expect(brief.contextText).toContain('Handoff: Do not hand this workstream off yet.');
            expect(brief.contextText).toContain('Local changes:');
            expect(brief.contextText).toContain('unmerged');

            const pack = handleRequest(graph, 'conn-workstream-conflicted', {
                method: 'getAgentContextPack',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, branch: 'master' }
            }, runtime()) as any;

            expect(pack.workstream.branch).toBe('master');
            expect(pack.workstream.hasUncommittedChanges).toBe(true);
            expect(pack.workstream.hasMergeConflicts).toBe(true);
            expect(pack.workstream.unmergedCount).toBeGreaterThanOrEqual(1);
            expect(pack.workstream.stateKind).toBe('conflicted');
            expect(pack.workstream.stateActionHint).toContain('Resolve merge conflicts');
            expect(pack.workstream.handoffReadiness).toBe('blocked');
            expect(pack.workstream.handoffBlockers).toContain('This workstream has unresolved merge conflicts.');
            expect(pack.promptText).toContain('State: Working tree has');
            expect(pack.promptText).toContain('Next: Resolve merge conflicts');
            expect(pack.promptText).toContain('Handoff: Do not hand this workstream off yet.');
        } finally {
            try {
                execFileSync('git', ['merge', '--abort'], { cwd: repoRoot, stdio: 'ignore' });
            } catch {
                // merge may already be cleaned up
            }
            db.close();
        }
    }, 15000);

    it('shows when a workstream is checked out only in another worktree', () => {
        if (!gitAvailable()) return;
        const { db, graph } = createGraph();
        try {
            const repoRoot = path.join(os.tmpdir(), `0ctx-worktree-occupancy-${Date.now()}`);
            const extraWorktree = path.join(os.tmpdir(), `0ctx-worktree-occupancy-extra-${Date.now()}`);
            tempDirs.push(repoRoot, extraWorktree);

            spawnSync('git', ['init', '--initial-branch', 'main', repoRoot], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.name', '0ctx test'], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'notes.txt')}' -Value 'base'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'add', '.'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'commit', '-m', 'base'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'worktree', 'add', extraWorktree, '-b', 'feature/other-worktree'], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(extraWorktree, 'notes.txt')}' -Value 'worktree branch'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', extraWorktree, 'add', '.'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', extraWorktree, 'commit', '-m', 'worktree branch'], { encoding: 'utf8', windowsHide: true });
            const worktreeHead = String(spawnSync('git', ['-C', extraWorktree, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).stdout ?? '').trim();

            const session = handleRequest(graph, 'conn-worktree', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-worktree', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'other-worktree-context', paths: [repoRoot] }
            }, runtime()) as { id: string };

            handleRequest(graph, 'conn-worktree', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    type: 'artifact',
                    hidden: true,
                    thread: 'session-worktree-1',
                    key: 'chat_session:claude:session-worktree-1',
                    content: 'session from another worktree',
                    tags: ['chat_session', 'agent:claude'],
                    rawPayload: {
                        sessionId: 'session-worktree-1',
                        branch: 'feature/other-worktree',
                        commitSha: worktreeHead,
                        agent: 'claude',
                        repositoryRoot: repoRoot
                    }
                }
            }, runtime());

            handleRequest(graph, 'conn-worktree', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    type: 'artifact',
                    hidden: true,
                    thread: 'session-worktree-1',
                    key: 'chat_turn:claude:session-worktree-1:msg-1',
                    content: 'turn from another worktree',
                    tags: ['chat_turn', 'role:assistant'],
                    rawPayload: {
                        sessionId: 'session-worktree-1',
                        messageId: 'msg-1',
                        role: 'assistant',
                        branch: 'feature/other-worktree',
                        commitSha: worktreeHead,
                        agent: 'claude',
                        repositoryRoot: repoRoot,
                        occurredAt: Date.now()
                    }
                }
            }, runtime());

            const lanes = handleRequest(graph, 'conn-worktree', {
                method: 'listBranchLanes',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as Array<{
                branch: string;
                checkedOutWorktreePaths: string[];
                checkedOutHere: boolean | null;
                checkedOutElsewhere: boolean | null;
                stateKind: string | null;
                stateSummary: string | null;
                stateActionHint: string | null;
                handoffReadiness?: 'ready' | 'review' | 'blocked';
                handoffSummary?: string | null;
            }>;

            expect(lanes).toHaveLength(1);
            expect(lanes[0].branch).toBe('feature/other-worktree');
            expect(lanes[0].checkedOutHere).toBe(false);
            expect(lanes[0].checkedOutElsewhere).toBe(true);
            expect(lanes[0].checkedOutWorktreePaths.map(item => path.resolve(item))).toContain(path.resolve(extraWorktree));
            expect(lanes[0].stateKind).toBe('elsewhere');
            expect(lanes[0].stateSummary).toContain('Checked out in another worktree');
            expect(lanes[0].stateActionHint).toContain('Open the checked-out worktree');
            expect(lanes[0].handoffReadiness).toBe('blocked');
            expect(lanes[0].handoffSummary).toContain('Do not hand this workstream off yet');

            const brief = handleRequest(graph, 'conn-worktree', {
                method: 'getWorkstreamBrief',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    branch: 'feature/other-worktree'
                }
            }, runtime()) as {
                checkedOutWorktreePaths: string[];
                checkedOutHere: boolean | null;
                checkedOutElsewhere: boolean | null;
                stateKind: string | null;
                stateSummary: string | null;
                stateActionHint: string | null;
                handoffReadiness?: 'ready' | 'review' | 'blocked';
                handoffSummary?: string | null;
                contextText: string;
            };

            expect(brief.checkedOutHere).toBe(false);
            expect(brief.checkedOutElsewhere).toBe(true);
            expect(brief.checkedOutWorktreePaths.map(item => path.resolve(item))).toContain(path.resolve(extraWorktree));
            expect(brief.stateKind).toBe('elsewhere');
            expect(brief.stateSummary).toContain('Checked out in another worktree');
            expect(brief.stateActionHint).toContain('Open the checked-out worktree');
            expect(brief.handoffReadiness).toBe('blocked');
            expect(brief.handoffSummary).toContain('Do not hand this workstream off yet');
            expect(brief.contextText).toContain('Status: Checked out in another worktree, not in the current checkout.');
            expect(brief.contextText).toContain('Recommended next step: Open the checked-out worktree before continuing on this workstream.');
            expect(brief.contextText).toContain('Handoff: Do not hand this workstream off yet.');
            expect(brief.contextText).toContain('Checkout: this workstream is checked out elsewhere');
            expect(brief.contextText).toContain(path.resolve(extraWorktree));
        } finally {
            db.close();
        }
    }, 15000);

    it('represents detached HEAD honestly in workstream context', () => {
        if (!gitAvailable()) return;
        const { db, graph } = createGraph();
        try {
            const repoRoot = path.join(os.tmpdir(), `0ctx-detached-head-${Date.now()}`);
            tempDirs.push(repoRoot);
            spawnSync('git', ['init', '--initial-branch', 'main', repoRoot], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.name', '0ctx test'], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'notes.txt')}' -Value 'base'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'add', '.'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'commit', '-m', 'base'], { encoding: 'utf8', windowsHide: true });
            const detachedHead = String(spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).stdout ?? '').trim();
            spawnSync('git', ['-C', repoRoot, 'checkout', '--detach'], { encoding: 'utf8', windowsHide: true });

            const session = handleRequest(graph, 'conn-detached', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-detached', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'detached-context', paths: [repoRoot] }
            }, runtime()) as { id: string };

            const brief = handleRequest(graph, 'conn-detached', {
                method: 'getWorkstreamBrief',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as {
                branch: string | null;
                currentHeadSha: string | null;
                currentHeadRef: string | null;
                isDetachedHead: boolean | null;
                tracked: boolean;
                stateKind: string | null;
                stateSummary: string | null;
                stateActionHint: string | null;
                handoffReadiness?: 'ready' | 'review' | 'blocked';
                handoffSummary?: string | null;
                baseline: { branch: string | null; comparable: boolean; summary: string } | null;
                contextText: string;
            };

            expect(brief.branch).toBeNull();
            expect(brief.currentHeadSha).toBe(detachedHead);
            expect(brief.currentHeadRef).toBeNull();
            expect(brief.isDetachedHead).toBe(true);
            expect(brief.tracked).toBe(false);
            expect(brief.stateKind).toBe('detached');
            expect(brief.stateSummary).toContain('Detached HEAD');
            expect(brief.stateActionHint).toContain('Create or switch to a named branch');
            expect(brief.handoffReadiness).toBe('blocked');
            expect(brief.handoffSummary).toContain('Do not hand this workstream off yet');
            expect(brief.handoffBlockers).toContain('This checkout is on detached HEAD and is not attached to a named branch.');
            expect(brief.handoffReviewItems).toEqual([]);
            expect(brief.baseline?.branch).toBe('main');
            expect(brief.baseline?.comparable).toBe(false);
            expect(brief.contextText).toContain('Status: Detached HEAD. This checkout is not on a named branch.');
            expect(brief.contextText).toContain('Recommended next step: Create or switch to a named branch before relying on this workstream.');
            expect(brief.contextText).toContain('Handoff: Do not hand this workstream off yet.');
            expect(brief.contextText).toContain(`Current workstream: detached HEAD @ ${detachedHead.slice(0, 12)}`);
            expect(brief.contextText).toContain(`Git state: detached HEAD at ${detachedHead.slice(0, 12)}.`);

            const pack = handleRequest(graph, 'conn-detached', {
                method: 'getAgentContextPack',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as {
                branch: string | null;
                workstream: {
                    branch: string | null;
                    currentHeadSha: string | null;
                    isDetachedHead: boolean | null;
                    stateKind: string | null;
                    stateSummary: string | null;
                    stateActionHint: string | null;
                    handoffReadiness?: 'ready' | 'review' | 'blocked';
                    handoffSummary?: string | null;
                };
                promptText: string;
            };

            expect(pack.branch).toBeNull();
            expect(pack.workstream.branch).toBeNull();
            expect(pack.workstream.currentHeadSha).toBe(detachedHead);
            expect(pack.workstream.isDetachedHead).toBe(true);
            expect(pack.workstream.stateKind).toBe('detached');
            expect(pack.workstream.stateSummary).toContain('Detached HEAD');
            expect(pack.workstream.stateActionHint).toContain('Create or switch to a named branch');
            expect(pack.workstream.handoffReadiness).toBe('blocked');
            expect(pack.workstream.handoffSummary).toContain('Do not hand this workstream off yet');
            expect(pack.promptText).toContain('0ctx workstream context');
            expect(pack.promptText).toContain(`Workstream: detached HEAD @ ${detachedHead.slice(0, 12)}`);
            expect(pack.promptText).toContain('State: Detached HEAD. This checkout is not on a named branch.');
            expect(pack.promptText).toContain('Next: Create or switch to a named branch before relying on this workstream.');
            expect(pack.promptText).toContain('Handoff: Do not hand this workstream off yet.');
        } finally {
            db.close();
        }
    }, 15000);

    it('represents a local-only workstream honestly when no upstream or baseline comparison exists', () => {
        if (!gitAvailable()) return;
        const { db, graph } = createGraph();
        try {
            const repoRoot = path.join(os.tmpdir(), `0ctx-isolated-workstream-${Date.now()}`);
            tempDirs.push(repoRoot);
            spawnSync('git', ['init', '--initial-branch', 'feature/local-only', repoRoot], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.name', '0ctx test'], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'notes.txt')}' -Value 'local only branch'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'add', '.'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'commit', '-m', 'local only'], { encoding: 'utf8', windowsHide: true });
            const branchHead = String(spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).stdout ?? '').trim();

            const session = handleRequest(graph, 'conn-isolated', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-isolated', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'isolated-workstream-context', paths: [repoRoot] }
            }, runtime()) as { id: string };

            handleRequest(graph, 'conn-isolated', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    thread: 'session-isolated-1',
                    type: 'artifact',
                    content: 'local only workstream session',
                    key: 'chat_session:claude:session-isolated-1',
                    tags: ['chat_session', 'agent:claude'],
                    source: 'hook:claude',
                    hidden: true,
                    rawPayload: {
                        sessionId: 'session-isolated-1',
                        branch: 'feature/local-only',
                        commitSha: branchHead,
                        agent: 'claude',
                        repositoryRoot: repoRoot
                    }
                }
            }, runtime());

            handleRequest(graph, 'conn-isolated', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    thread: 'session-isolated-1',
                    type: 'artifact',
                    content: 'local only workstream turn',
                    key: 'chat_turn:claude:session-isolated-1:msg-1',
                    tags: ['chat_turn', 'role:assistant'],
                    source: 'hook:claude',
                    hidden: true,
                    rawPayload: {
                        sessionId: 'session-isolated-1',
                        messageId: 'msg-1',
                        role: 'assistant',
                        branch: 'feature/local-only',
                        commitSha: branchHead,
                        agent: 'claude',
                        repositoryRoot: repoRoot,
                        occurredAt: Date.now()
                    }
                }
            }, runtime());

            const brief = handleRequest(graph, 'conn-isolated', {
                method: 'getWorkstreamBrief',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as {
                branch: string | null;
                upstream: string | null;
                baseline: { comparable: boolean; branch: string | null; summary: string } | null;
                stateKind: string | null;
                stateSummary: string | null;
                stateActionHint: string | null;
                handoffReadiness?: 'ready' | 'review' | 'blocked';
                handoffSummary?: string | null;
                contextText: string;
            };

            expect(brief.branch).toBe('feature/local-only');
            expect(brief.upstream).toBeNull();
            expect(brief.baseline?.comparable).toBe(false);
            expect(brief.stateKind).toBe('isolated');
            expect(brief.stateSummary).toContain('Local-only workstream with no upstream or baseline comparison');
            expect(brief.stateActionHint).toContain('Create a checkpoint before handing this workstream off');
            expect(brief.handoffReadiness).toBe('review');
            expect(brief.handoffSummary).toContain('Review before handoff');
            expect(brief.contextText).toContain('Status: Local-only workstream with no upstream or baseline comparison.');
            expect(brief.contextText).toContain('Recommended next step: Create a checkpoint before handing this workstream off or comparing it elsewhere.');
            expect(brief.contextText).toContain('Git state: local-only workstream without upstream or baseline comparison.');
            expect(brief.contextText).not.toContain('Git state: current local workstream.');

            const lanes = handleRequest(graph, 'conn-isolated', {
                method: 'listBranchLanes',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as Array<{
                stateKind: string | null;
                stateSummary: string | null;
                stateActionHint: string | null;
                handoffReadiness?: 'ready' | 'review' | 'blocked';
            }>;

            expect(lanes).toHaveLength(1);
            expect(lanes[0].stateKind).toBe('isolated');
            expect(lanes[0].stateSummary).toContain('Local-only workstream');
            expect(lanes[0].stateActionHint).toContain('Create a checkpoint');
            expect(lanes[0].handoffReadiness).toBe('review');
        } finally {
            db.close();
        }
    }, 15000);

    it('compares workstreams with real git divergence and activity context', () => {
        if (!gitAvailable()) return;
        const { db, graph } = createGraph();
        try {
            const repoRoot = path.join(os.tmpdir(), `0ctx-workstream-compare-${Date.now()}`);
            tempDirs.push(repoRoot);

            spawnSync('git', ['init', '--initial-branch', 'main', repoRoot], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.name', '0ctx test'], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'notes.txt')}' -Value 'base'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'add', '.'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'commit', '-m', 'base'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'checkout', '-b', 'feature/runtime-compare'], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'notes.txt')}' -Value 'feature'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'add', '.'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'commit', '-m', 'feature'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'checkout', 'main'], { encoding: 'utf8', windowsHide: true });

            const session = handleRequest(graph, 'conn-compare', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-compare', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'compare-context', paths: [repoRoot] }
            }, runtime()) as { id: string };

            const now = Date.now();
            const addCapturedMessage = (thread: string, branch: string, agent: string, occurredAt: number) => {
                handleRequest(graph, 'conn-compare', {
                    method: 'addNode',
                    sessionToken: session.sessionToken,
                    params: {
                        contextId: context.id,
                        type: 'artifact',
                        hidden: true,
                        thread,
                        key: `chat_session:${agent}:${thread}`,
                        content: `${branch} summary`,
                        tags: ['chat_session', `agent:${agent}`],
                        rawPayload: {
                            sessionId: thread,
                            branch,
                            agent,
                            worktreePath: repoRoot,
                            repositoryRoot: repoRoot
                        }
                    }
                }, runtime());

                handleRequest(graph, 'conn-compare', {
                    method: 'addNode',
                    sessionToken: session.sessionToken,
                    params: {
                        contextId: context.id,
                        type: 'artifact',
                        hidden: true,
                        thread,
                        key: `chat_turn:${agent}:${thread}:msg-1`,
                        content: `${branch} captured turn`,
                        tags: ['chat_turn', 'role:assistant'],
                        rawPayload: {
                            sessionId: thread,
                            messageId: 'msg-1',
                            role: 'assistant',
                            branch,
                            agent,
                            worktreePath: repoRoot,
                            repositoryRoot: repoRoot,
                            occurredAt
                        }
                    }
                }, runtime());
            };

            addCapturedMessage('session-main-1', 'main', 'factory', now - 60_000);
            addCapturedMessage('session-feature-1', 'feature/runtime-compare', 'claude', now);

            const comparison = handleRequest(graph, 'conn-compare', {
                method: 'compareWorkstreams',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    sourceBranch: 'main',
                    targetBranch: 'feature/runtime-compare'
                }
            }, runtime()) as {
                sameRepository: boolean;
                comparable: boolean;
                sourceAheadCount: number | null;
                targetAheadCount: number | null;
                mergeBaseSha: string | null;
                comparisonKind: string;
                comparisonReadiness?: string;
                comparisonSummary: string;
                comparisonActionHint: string | null;
                reconcileStrategy: string;
                reconcileStrategySummary: string;
                reconcileSteps: string[];
                sourceChangedFileCount: number | null;
                targetChangedFileCount: number | null;
                sharedChangedFileCount: number | null;
                sharedConflictLikelyCount: number | null;
                sharedConflictLikelyFiles: string[];
                changeOverlapKind: string;
                changeOverlapSummary: string;
                lineOverlapKind: string;
                lineOverlapSummary: string;
                mergeRisk: string;
                mergeRiskSummary: string;
                sharedChangedFiles: string[];
                source: { sessionCount: number; branch: string | null };
                target: { sessionCount: number; branch: string | null };
                sourceOnlyAgents: string[];
                targetOnlyAgents: string[];
                comparisonText: string;
                newerSide: string;
            };

            expect(comparison.sameRepository).toBe(true);
            expect(comparison.comparable).toBe(true);
            expect(comparison.sourceAheadCount).toBe(0);
            expect(comparison.targetAheadCount).toBe(1);
            expect(comparison.mergeBaseSha).toBeTruthy();
            expect(comparison.source.branch).toBe('main');
            expect(comparison.target.branch).toBe('feature/runtime-compare');
            expect(comparison.source.sessionCount).toBe(1);
            expect(comparison.target.sessionCount).toBe(1);
            expect(comparison.sourceOnlyAgents).toEqual(['factory']);
            expect(comparison.targetOnlyAgents).toEqual(['claude']);
            expect(comparison.newerSide).toBe('target');
            expect(comparison.comparisonKind).toBe('target_ahead');
            expect(comparison.comparisonReadiness).toBe('review');
            expect(comparison.comparisonSummary).toContain('feature/runtime-compare is ahead of main');
            expect(comparison.comparisonActionHint).toContain('Update or compare main');
            expect(comparison.reconcileStrategy).toBe('fast_forward_source_to_target');
            expect(comparison.reconcileStrategySummary).toContain('Fast-forward main to feature/runtime-compare');
            expect(comparison.reconcileSteps).toEqual([
                'Open main.',
                'Fast-forward it to feature/runtime-compare.',
                'Create a checkpoint after the update before handing the workstream to another agent.'
            ]);
            expect(comparison.sourceChangedFileCount).toBe(0);
            expect(comparison.targetChangedFileCount).toBe(1);
            expect(comparison.sharedChangedFileCount).toBe(0);
            expect(comparison.sharedConflictLikelyCount).toBe(0);
            expect(comparison.sharedConflictLikelyFiles).toEqual([]);
            expect(comparison.changeOverlapKind).toBe('none');
            expect(comparison.changeOverlapSummary).toContain('different files');
            expect(comparison.lineOverlapKind).toBe('none');
            expect(comparison.lineOverlapSummary).toContain('No overlapping changed line ranges');
            expect(comparison.mergeRisk).toBe('low');
            expect(comparison.mergeRiskSummary).toContain('Low merge risk');
            expect(comparison.sharedChangedFiles).toEqual([]);
            expect(comparison.comparisonText).toContain('Source: main');
            expect(comparison.comparisonText).toContain('Target: feature/runtime-compare');
            expect(comparison.comparisonText).toContain('Readiness: review');
            expect(comparison.comparisonText).toContain('Recommended next step:');
            expect(comparison.comparisonText).toContain('Changed files:');
            expect(comparison.comparisonText).toContain('Reconcile: Fast-forward main to feature/runtime-compare.');
            expect(comparison.comparisonText).toContain('Reconcile steps: 1) Open main. 2) Fast-forward it to feature/runtime-compare.');
        } finally {
            db.close();
        }
    }, 15000);

    it('surfaces shared changed-file overlap for diverged workstreams', () => {
        if (!gitAvailable()) return;
        const { db, graph } = createGraph();
        const repoRoot = mkdtempSync(path.join(os.tmpdir(), '0ctx-workstream-overlap-'));
        tempDirs.push(repoRoot);
        try {
            spawnSync('git', ['init', '-b', 'main', repoRoot], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.name', 'Test User'], { encoding: 'utf8', windowsHide: true });
            const sharedDir = path.join(repoRoot, 'packages', 'core');
            mkdirSync(sharedDir, { recursive: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'shared.txt')}' -Value 'base'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(sharedDir, 'shared.ts')}' -Value 'export const base = true;'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'base.txt')}' -Value 'base'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'add', '.'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'commit', '-m', 'base'], { encoding: 'utf8', windowsHide: true });

            spawnSync('git', ['-C', repoRoot, 'checkout', '-b', 'feature/shared-overlap'], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'shared.txt')}' -Value 'feature change'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(sharedDir, 'shared.ts')}' -Value 'export const feature = true;'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'feature-only.txt')}' -Value 'feature only'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'add', '.'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'commit', '-m', 'feature overlap'], { encoding: 'utf8', windowsHide: true });

            spawnSync('git', ['-C', repoRoot, 'checkout', 'main'], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'shared.txt')}' -Value 'main change'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(sharedDir, 'shared.ts')}' -Value 'export const main = true;'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'main-only.txt')}' -Value 'main only'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'add', '.'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'commit', '-m', 'main overlap'], { encoding: 'utf8', windowsHide: true });

            const session = handleRequest(graph, 'conn-overlap', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-overlap', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'overlap-context', paths: [repoRoot] }
            }, runtime()) as { id: string };

            const addCapturedMessage = (thread: string, branch: string, agent: string, occurredAt: number) => {
                handleRequest(graph, 'conn-overlap', {
                    method: 'addNode',
                    sessionToken: session.sessionToken,
                    params: {
                        contextId: context.id,
                        type: 'artifact',
                        hidden: true,
                        thread,
                        key: `chat_session:${agent}:${thread}`,
                        content: `${branch} summary`,
                        tags: ['chat_session', `agent:${agent}`],
                        rawPayload: { sessionId: thread, branch, agent, worktreePath: repoRoot, repositoryRoot: repoRoot }
                    }
                }, runtime());

                handleRequest(graph, 'conn-overlap', {
                    method: 'addNode',
                    sessionToken: session.sessionToken,
                    params: {
                        contextId: context.id,
                        type: 'artifact',
                        hidden: true,
                        thread,
                        key: `chat_turn:${agent}:${thread}:msg-1`,
                        content: `${branch} captured turn`,
                        tags: ['chat_turn', 'role:assistant'],
                        rawPayload: {
                            sessionId: thread,
                            messageId: 'msg-1',
                            role: 'assistant',
                            branch,
                            agent,
                            worktreePath: repoRoot,
                            repositoryRoot: repoRoot,
                            occurredAt
                        }
                    }
                }, runtime());
            };

            const now = Date.now();
            addCapturedMessage('session-main-overlap', 'main', 'factory', now - 60_000);
            addCapturedMessage('session-feature-overlap', 'feature/shared-overlap', 'claude', now);

            const comparison = handleRequest(graph, 'conn-overlap', {
                method: 'compareWorkstreams',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    sourceBranch: 'main',
                    targetBranch: 'feature/shared-overlap'
                }
            }, runtime()) as {
                sourceAheadCount: number | null;
                targetAheadCount: number | null;
                sharedChangedFileCount: number | null;
                sharedChangedFiles: string[];
                sharedConflictLikelyCount: number | null;
                sharedConflictLikelyFiles: string[];
                sharedChangedAreas: string[];
                sourceOnlyChangedFiles: string[];
                targetOnlyChangedFiles: string[];
                changeOverlapKind: string;
                changeOverlapSummary: string;
                lineOverlapKind: string;
                lineOverlapSummary: string;
                changeHotspotSummary: string;
                mergeRisk: string;
                mergeRiskSummary: string;
                reconcileStrategy: string;
                reconcileStrategySummary: string;
                reconcileSteps: string[];
                comparisonText: string;
            };

            expect(comparison.sourceAheadCount).toBe(1);
            expect(comparison.targetAheadCount).toBe(1);
            expect(comparison.sharedChangedFileCount).toBe(2);
            expect(comparison.sharedChangedFiles).toContain('shared.txt');
            expect(comparison.sharedChangedFiles).toContain('packages/core/shared.ts');
            expect(comparison.sharedConflictLikelyCount).toBe(2);
            expect(comparison.sharedConflictLikelyFiles).toContain('shared.txt');
            expect(comparison.sharedConflictLikelyFiles).toContain('packages/core/shared.ts');
            expect(comparison.sharedChangedAreas).toContain('packages/core');
            expect(comparison.sourceOnlyChangedFiles).toContain('main-only.txt');
            expect(comparison.targetOnlyChangedFiles).toContain('feature-only.txt');
            expect(comparison.changeOverlapKind).toBe('high');
            expect(comparison.changeOverlapSummary).toContain('shared.txt');
            expect(comparison.lineOverlapKind).toBe('high');
            expect(comparison.lineOverlapSummary).toContain('overlapping line ranges');
            expect(comparison.changeHotspotSummary).toContain('packages/core');
            expect(comparison.mergeRisk).toBe('high');
            expect(comparison.mergeRiskSummary).toContain('High merge risk');
            expect(comparison.reconcileStrategy).toBe('manual_conflict_resolution');
            expect(comparison.reconcileStrategySummary).toContain('Manual reconcile is recommended');
            expect(comparison.reconcileSteps).toContain('Review the shared changed files before choosing merge or rebase.');
            expect(comparison.reconcileSteps.some((step) => step.includes('Resolve likely conflicts in'))).toBe(true);
            expect(comparison.reconcileSteps).toContain('Create a checkpoint after reconciliation and before handoff.');
            expect(comparison.comparisonBlockers).toEqual([]);
            expect(comparison.comparisonReviewItems).toContain('Both workstreams have diverged and need explicit reconciliation before handoff.');
            expect(comparison.comparisonReviewItems).toContain('Both workstreams touch overlapping line ranges in shared files; resolve those conflicts before handoff or merge.');
            expect(comparison.comparisonReviewItems).toContain('Both workstreams modify many of the same files; review those files before merging or handing work off.');
            expect(comparison.comparisonReviewItems.some((item) => item.includes('Focus review on:'))).toBe(true);
            expect(comparison.comparisonText).toContain('Shared files: packages/core/shared.ts, shared.txt.');
            expect(comparison.comparisonText).toContain('Likely conflict files: packages/core/shared.ts, shared.txt.');
            expect(comparison.comparisonText).toContain('Changed lines:');
            expect(comparison.comparisonText).toContain('Hotspots: Shared change hotspots:');
            expect(comparison.comparisonText).toContain('Merge risk: High merge risk');
            expect(comparison.comparisonText).toContain('Reconcile: Manual reconcile is recommended.');
            expect(comparison.comparisonText).toContain('Reconcile steps: 1) Review the shared changed files before choosing merge or rebase.');
            expect(comparison.comparisonText).toContain('Review:');
        } finally {
            db.close();
        }
    }, 20_000);

    it('compares workspaces explicitly by repository overlap and reviewed insights', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-workspace-compare', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const source = handleRequest(graph, 'conn-workspace-compare', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'source-workspace', paths: ['C:\\repo\\shared'] }
            }, runtime()) as { id: string };
            const target = handleRequest(graph, 'conn-workspace-compare', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'target-workspace', paths: ['C:\\repo\\shared'] }
            }, runtime()) as { id: string };

            handleRequest(graph, 'conn-workspace-compare', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: source.id,
                    type: 'decision',
                    content: 'Keep reviewed insights explicit when promoting across workspaces.',
                    tags: ['branch:main']
                }
            }, runtime());

            handleRequest(graph, 'conn-workspace-compare', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: target.id,
                    type: 'decision',
                    content: 'Keep reviewed insights explicit when promoting across workspaces.',
                    tags: ['branch:main']
                }
            }, runtime());

            const comparison = handleRequest(graph, 'conn-workspace-compare', {
                method: 'compareWorkspaces',
                sessionToken: session.sessionToken,
                params: {
                    sourceContextId: source.id,
                    targetContextId: target.id
                }
            }, runtime()) as {
                comparisonKind: string;
                sharedRepositoryPaths: string[];
                sharedInsights: string[];
                comparisonSummary: string;
            };

            expect(comparison.comparisonKind).toBe('same_repository');
            expect(comparison.sharedRepositoryPaths.length).toBeGreaterThan(0);
            expect(comparison.sharedInsights.length).toBeGreaterThan(0);
            expect(comparison.comparisonSummary).toContain('same repository path');
        } finally {
            db.close();
        }
    });

    it('extracts visible knowledge nodes from sessions and checkpoints through daemon methods', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-extract', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-extract', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'extract-context' }
            }, runtime()) as { id: string };

            handleRequest(graph, 'conn-extract', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    type: 'artifact',
                    hidden: true,
                    thread: 'session-extract-1',
                    key: 'chat_session:factory:session-extract-1',
                    content: 'extract session summary',
                    tags: ['chat_session', 'agent:factory'],
                    rawPayload: {
                        sessionId: 'session-extract-1',
                        branch: 'feature/extract',
                        agent: 'factory'
                    }
                }
            }, runtime());

            handleRequest(graph, 'conn-extract', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    type: 'artifact',
                    hidden: true,
                    thread: 'session-extract-1',
                    key: 'chat_turn:factory:session-extract-1:user-1',
                    content: 'We need to keep the graph focused on visible project decisions.',
                    tags: ['chat_turn', 'role:user'],
                    rawPayload: {
                        sessionId: 'session-extract-1',
                        messageId: 'user-1',
                        role: 'user'
                    }
                }
            }, runtime());

            handleRequest(graph, 'conn-extract', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    type: 'artifact',
                    hidden: true,
                    thread: 'session-extract-1',
                    key: 'chat_turn:factory:session-extract-1:assistant-1',
                    content: 'We are going with visible decision nodes and hidden raw capture nodes.',
                    tags: ['chat_turn', 'role:assistant'],
                    rawPayload: {
                        sessionId: 'session-extract-1',
                        messageId: 'assistant-1',
                        role: 'assistant'
                    }
                }
            }, runtime());

            const preview = handleRequest(graph, 'conn-extract', {
                method: 'previewSessionKnowledge',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, sessionId: 'session-extract-1' }
            }, runtime()) as { candidateCount: number; createCount: number };
            expect(preview.candidateCount).toBeGreaterThan(0);
            expect(preview.createCount).toBeGreaterThan(0);

            const extracted = handleRequest(graph, 'conn-extract', {
                method: 'extractSessionKnowledge',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, sessionId: 'session-extract-1' }
            }, runtime()) as { createdCount: number; nodeCount: number };
            expect(extracted.createdCount).toBeGreaterThan(0);
            expect(extracted.nodeCount).toBeGreaterThan(0);

            const checkpoint = handleRequest(graph, 'conn-extract', {
                method: 'createSessionCheckpoint',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, sessionId: 'session-extract-1', summary: 'extract checkpoint' }
            }, runtime()) as { id: string; knowledge?: { nodeCount?: number; createdCount?: number } };
            expect(checkpoint.knowledge).toBeTruthy();
            expect(typeof checkpoint.knowledge?.nodeCount).toBe('number');
            expect(typeof checkpoint.knowledge?.createdCount).toBe('number');

            const previewCheckpoint = handleRequest(graph, 'conn-extract', {
                method: 'previewCheckpointKnowledge',
                sessionToken: session.sessionToken,
                params: { checkpointId: checkpoint.id }
            }, runtime()) as { checkpointId: string | null; candidateCount: number };
            expect(previewCheckpoint.checkpointId).toBe(checkpoint.id);
            expect(previewCheckpoint.candidateCount).toBeGreaterThan(0);

            const highConfidencePreview = handleRequest(graph, 'conn-extract', {
                method: 'previewSessionKnowledge',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, sessionId: 'session-extract-1', minConfidence: 0.97 }
            }, runtime()) as { candidateCount: number };
            expect(highConfidencePreview.candidateCount).toBe(0);

            const fromCheckpoint = handleRequest(graph, 'conn-extract', {
                method: 'extractCheckpointKnowledge',
                sessionToken: session.sessionToken,
                params: { checkpointId: checkpoint.id }
            }, runtime()) as { checkpointId: string | null; nodeCount: number };
            expect(fromCheckpoint.checkpointId).toBe(checkpoint.id);
            expect(fromCheckpoint.nodeCount).toBeGreaterThan(0);

            const audit = handleRequest(graph, 'conn-extract', {
                method: 'listAuditEvents',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, limit: 20 }
            }, runtime()) as Array<{ action: string }>;
            expect(audit.filter(event => event.action === 'extract_knowledge').length).toBeGreaterThan(0);
        } finally {
            db.close();
        }
    });

    it('supports temporal, topic, graph, and auto recall methods', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-recall', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-recall', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'recall-context' }
            }, runtime()) as { id: string };

            const first = handleRequest(graph, 'conn-recall', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'goal', content: 'Improve sleep quality with routine' }
            }, runtime()) as { id: string };

            const second = handleRequest(graph, 'conn-recall', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'decision', content: 'Sleep interrupted at 3am, enforce bedtime protocol', tags: ['sleep'] }
            }, runtime()) as { id: string };

            handleRequest(graph, 'conn-recall', {
                method: 'addEdge',
                sessionToken: session.sessionToken,
                params: { fromId: second.id, toId: first.id, relation: 'supersedes' }
            }, runtime());

            const temporal = handleRequest(graph, 'conn-recall', {
                method: 'recallTemporal',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, sinceHours: 24, limit: 10 }
            }, runtime()) as { mode: string; totalEvents: number; sessions: unknown[] };

            const topic = handleRequest(graph, 'conn-recall', {
                method: 'recallTopic',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, query: 'sleep', sinceHours: 24, limit: 10 }
            }, runtime()) as { mode: string; hits: Array<{ nodeId: string; matchReason: string }> };

            const graphRecall = handleRequest(graph, 'conn-recall', {
                method: 'recallGraph',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, query: 'sleep', depth: 2, maxNodes: 20, limit: 5 }
            }, runtime()) as { mode: string; anchors: unknown[]; subgraph: { nodes: unknown[]; edges: unknown[] } };

            const auto = handleRequest(graph, 'conn-recall', {
                method: 'recall',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, mode: 'auto', query: 'sleep', sinceHours: 24, limit: 10 }
            }, runtime()) as { mode: string; summary: { topicHitCount: number; sessionCount: number } };

            expect(temporal.mode).toBe('temporal');
            expect(temporal.totalEvents).toBeGreaterThan(0);
            expect(temporal.sessions.length).toBeGreaterThan(0);

            expect(topic.mode).toBe('topic');
            expect(topic.hits.length).toBeGreaterThan(0);
            expect(topic.hits[0].nodeId).toBeTruthy();
            expect(topic.hits[0].matchReason).toBeTruthy();

            expect(graphRecall.mode).toBe('graph');
            expect(graphRecall.anchors.length).toBeGreaterThan(0);
            expect(graphRecall.subgraph.nodes.length).toBeGreaterThan(0);

            expect(auto.mode).toBe('auto');
            expect(auto.summary.topicHitCount).toBeGreaterThan(0);
            expect(auto.summary.sessionCount).toBeGreaterThan(0);
        } finally {
            db.close();
        }
    });

    it('records recall feedback as an audit event', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-feedback', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-feedback', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'recall-feedback-context' }
            }, runtime()) as { id: string };

            const node = handleRequest(graph, 'conn-feedback', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'artifact', content: 'Recall target node for feedback' }
            }, runtime()) as { id: string };

            const feedback = handleRequest(graph, 'conn-feedback', {
                method: 'recallFeedback',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    nodeId: node.id,
                    helpful: true,
                    reason: 'top result matched user intent'
                }
            }, runtime()) as { ok: boolean; nodeId: string; helpful: boolean };

            const audit = handleRequest(graph, 'conn-feedback', {
                method: 'listAuditEvents',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, limit: 20 }
            }, runtime()) as Array<{ action: string; payload?: Record<string, unknown> }>;
            const listed = handleRequest(graph, 'conn-feedback', {
                method: 'listRecallFeedback',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, limit: 10 }
            }, runtime()) as {
                total: number;
                helpfulCount: number;
                notHelpfulCount: number;
                items: Array<{ nodeId: string; helpful: boolean }>;
            };

            expect(feedback.ok).toBe(true);
            expect(feedback.nodeId).toBe(node.id);
            expect(feedback.helpful).toBe(true);
            expect(audit.some(event => event.action === 'recall_feedback')).toBe(true);
            expect(listed.total).toBeGreaterThanOrEqual(1);
            expect(listed.helpfulCount).toBeGreaterThanOrEqual(1);
            expect(listed.notHelpfulCount).toBe(0);
            expect(listed.items.some(item => item.nodeId === node.id && item.helpful)).toBe(true);
        } finally {
            db.close();
        }
    });

    it('records and polls blackboard events via subscriptions', () => {
        const { db, graph } = createGraph();
        const events = new EventRuntime();
        const ctxRuntime: HandlerRuntimeContext = {
            ...runtime(),
            eventRuntime: events
        };

        try {
            const session = handleRequest(graph, 'conn-a', { method: 'createSession' }, ctxRuntime) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-a', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'blackboard-context' }
            }, ctxRuntime) as { id: string };

            const subscription = handleRequest(graph, 'conn-a', {
                method: 'subscribeEvents',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, types: ['NodeAdded'] }
            }, ctxRuntime) as { subscriptionId: string };

            handleRequest(graph, 'conn-a', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'goal', content: 'Track blackboard events' }
            }, ctxRuntime);

            const polled = handleRequest(graph, 'conn-a', {
                method: 'pollEvents',
                sessionToken: session.sessionToken,
                params: { subscriptionId: subscription.subscriptionId }
            }, ctxRuntime) as { events: Array<{ type: string; contextId: string | null; sequence: number }> };

            expect(polled.events.length).toBeGreaterThan(0);
            expect(polled.events.some(event => event.type === 'NodeAdded')).toBe(true);
            expect(polled.events.every(event => event.contextId === context.id)).toBe(true);
        } finally {
            db.close();
        }
    });

    it('enforces task lease ownership semantics', () => {
        const { db, graph } = createGraph();
        const events = new EventRuntime();
        const ctxRuntime: HandlerRuntimeContext = {
            ...runtime(),
            eventRuntime: events
        };

        try {
            const sessionA = handleRequest(graph, 'conn-a', { method: 'createSession' }, ctxRuntime) as { sessionToken: string };
            const sessionB = handleRequest(graph, 'conn-b', { method: 'createSession' }, ctxRuntime) as { sessionToken: string };

            const claimA = handleRequest(graph, 'conn-a', {
                method: 'claimTask',
                sessionToken: sessionA.sessionToken,
                params: { taskId: 'task-1', leaseMs: 30000 }
            }, ctxRuntime) as { claimed: boolean };

            const claimBWhileHeld = handleRequest(graph, 'conn-b', {
                method: 'claimTask',
                sessionToken: sessionB.sessionToken,
                params: { taskId: 'task-1', leaseMs: 30000 }
            }, ctxRuntime) as { claimed: boolean };

            const releaseA = handleRequest(graph, 'conn-a', {
                method: 'releaseTask',
                sessionToken: sessionA.sessionToken,
                params: { taskId: 'task-1' }
            }, ctxRuntime) as { released: boolean };

            const claimBAfterRelease = handleRequest(graph, 'conn-b', {
                method: 'claimTask',
                sessionToken: sessionB.sessionToken,
                params: { taskId: 'task-1', leaseMs: 30000 }
            }, ctxRuntime) as { claimed: boolean };

            expect(claimA.claimed).toBe(true);
            expect(claimBWhileHeld.claimed).toBe(false);
            expect(releaseA.released).toBe(true);
            expect(claimBAfterRelease.claimed).toBe(true);
        } finally {
            db.close();
        }
    });

    it('evaluates blackboard completion deterministically', () => {
        const { db, graph } = createGraph();
        const events = new EventRuntime();
        const ctxRuntime: HandlerRuntimeContext = {
            ...runtime(),
            eventRuntime: events
        };

        try {
            const session = handleRequest(graph, 'conn-a', { method: 'createSession' }, ctxRuntime) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-a', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'completion-context' }
            }, ctxRuntime) as { id: string };

            handleRequest(graph, 'conn-a', {
                method: 'claimTask',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, taskId: 'task-1', leaseMs: 60_000 }
            }, ctxRuntime);
            handleRequest(graph, 'conn-a', {
                method: 'resolveGate',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, gateId: 'typecheck', status: 'open', severity: 'high' }
            }, ctxRuntime);

            const blocked = handleRequest(graph, 'conn-a', {
                method: 'evaluateCompletion',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, cooldownMs: 0, requiredGates: ['typecheck'] }
            }, ctxRuntime) as { complete: boolean; reasons: string[] };

            handleRequest(graph, 'conn-a', {
                method: 'releaseTask',
                sessionToken: session.sessionToken,
                params: { taskId: 'task-1' }
            }, ctxRuntime);
            handleRequest(graph, 'conn-a', {
                method: 'resolveGate',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, gateId: 'typecheck', status: 'resolved' }
            }, ctxRuntime);

            const complete = handleRequest(graph, 'conn-a', {
                method: 'evaluateCompletion',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, cooldownMs: 0, requiredGates: ['typecheck'] }
            }, ctxRuntime) as { complete: boolean; reasons: string[] };

            expect(blocked.complete).toBe(false);
            expect(blocked.reasons).toContain('open_gates');
            expect(blocked.reasons).toContain('active_leases');
            expect(complete.complete).toBe(true);
            expect(complete.reasons).toHaveLength(0);
        } finally {
            db.close();
        }
    });

    it('promotes a reviewed insight into another workspace and audits it', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-promote', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const source = handleRequest(graph, 'conn-promote', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'source-workspace' }
            }, runtime()) as { id: string };
            const target = handleRequest(graph, 'conn-promote', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'target-workspace' }
            }, runtime()) as { id: string };

            const evidence = handleRequest(graph, 'conn-promote', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: source.id,
                    thread: 'session-promote-1',
                    type: 'artifact',
                    content: 'Promote reviewed checkpoint guidance across workspaces.',
                    key: 'chat_turn:factory:session-promote-1:assistant-1',
                    tags: ['chat_turn', 'role:assistant', 'branch:feat/promotion'],
                    source: 'hook:factory',
                    hidden: true
                }
            }, runtime()) as { id: string };

            const corroboratingUserEvidence = handleRequest(graph, 'conn-promote', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: source.id,
                    thread: 'session-promote-1',
                    type: 'artifact',
                    content: 'Please promote reviewed checkpoint guidance across workspaces.',
                    key: 'chat_turn:factory:session-promote-1:user-1',
                    tags: ['chat_turn', 'role:user', 'branch:feat/promotion'],
                    source: 'hook:factory',
                    hidden: true
                }
            }, runtime()) as { id: string };

            const node = handleRequest(graph, 'conn-promote', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: source.id,
                    type: 'decision',
                    content: 'Promote reviewed checkpoint guidance across workspaces.',
                    tags: ['knowledge', 'branch:feat/promotion']
                }
            }, runtime()) as { id: string };

            handleRequest(graph, 'conn-promote', {
                method: 'addEdge',
                sessionToken: session.sessionToken,
                params: {
                    contextId: source.id,
                    fromId: node.id,
                    toId: evidence.id,
                    relation: 'caused_by'
                }
            }, runtime());

            handleRequest(graph, 'conn-promote', {
                method: 'addEdge',
                sessionToken: session.sessionToken,
                params: {
                    contextId: source.id,
                    fromId: node.id,
                    toId: corroboratingUserEvidence.id,
                    relation: 'caused_by'
                }
            }, runtime());

            const promoted = handleRequest(graph, 'conn-promote', {
                method: 'promoteInsight',
                sessionToken: session.sessionToken,
                params: {
                    contextId: target.id,
                    sourceContextId: source.id,
                    nodeId: node.id
                }
            }, runtime()) as {
                targetNodeId: string;
                created: boolean;
                reused: boolean;
                branch: string | null;
            };

            expect(promoted.created).toBe(true);
            expect(promoted.reused).toBe(false);
            expect(promoted.branch).toBe('feat/promotion');

            const targetNode = graph.getNode(promoted.targetNodeId);
            expect(targetNode?.contextId).toBe(target.id);

            const audits = graph.listAuditEvents(target.id, 20);
            expect(audits.some((entry) => entry.action === 'promote_insight')).toBe(true);
        } finally {
            db.close();
        }
    });

    it('rejects blocked reviewed insight promotion over daemon IPC', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-promote-blocked', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const source = handleRequest(graph, 'conn-promote-blocked', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'source-workspace' }
            }, runtime()) as { id: string };
            const target = handleRequest(graph, 'conn-promote-blocked', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'target-workspace' }
            }, runtime()) as { id: string };

            const weakNode = handleRequest(graph, 'conn-promote-blocked', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: source.id,
                    type: 'assumption',
                    content: 'Maybe the branch is fine as-is.',
                    tags: ['knowledge', 'branch:feat/promotion-block']
                }
            }, runtime()) as { id: string };

            expect(() => handleRequest(graph, 'conn-promote-blocked', {
                method: 'promoteInsight',
                sessionToken: session.sessionToken,
                params: {
                    contextId: target.id,
                    sourceContextId: source.id,
                    nodeId: weakNode.id
                }
            }, runtime())).toThrow(/weak insight candidates/i);
        } finally {
            db.close();
        }
    });
});


