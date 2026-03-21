import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    getHookConfigPath,
    installHooks,
    matchesHookCaptureRoot,
    normalizeHookPayload,
    readCodexArchiveCapture,
    readCodexCapture,
    readInlineHookCapture,
    readTranscriptCapture,
    resolveCodexSessionArchivePath,
    selectHookContextId,
    resolveHookCaptureRoot,
    readHookInstallState
} from '../src/hooks';

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '0ctx-cli-hooks-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    delete process.env.CTX_HOOK_STATE_PATH;
    if (originalHome === undefined) {
        delete process.env.HOME;
    } else {
        process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
        delete process.env.USERPROFILE;
    } else {
        process.env.USERPROFILE = originalUserProfile;
    }
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('hook install workflow', () => {
    it('keeps Codex notify config generic for installed users', () => {
        const repoRoot = createTempDir();
        process.env.CTX_HOOK_STATE_PATH = path.join(repoRoot, '.0ctx', 'hooks-state.json');

        const result = installHooks({
            projectRoot: repoRoot,
            clients: ['codex']
        });

        expect(result.codexNotifyConfigured).toBe(true);

        const configToml = fs.readFileSync(result.codexConfigPath, 'utf8');
        expect(configToml).toContain('notify = ["0ctx", "hook", "ingest", "--agent=codex", "--payload"]');
        expect(configToml).not.toContain(process.execPath);
        expect(fs.existsSync(path.join(repoRoot, '.0ctx', 'codex-notify.js'))).toBe(false);
    });

    it('is idempotent across repeated installs', () => {
        const repoRoot = createTempDir();
        process.env.CTX_HOOK_STATE_PATH = path.join(repoRoot, '.0ctx', 'hooks-state.json');

        const first = installHooks({
            projectRoot: repoRoot,
            contextId: 'ctx-1',
            clients: ['claude', 'codex', 'cursor']
        });
        const second = installHooks({
            projectRoot: repoRoot,
            contextId: 'ctx-1',
            clients: ['claude', 'codex', 'cursor']
        });

        expect(first.changed).toBe(true);
        expect(second.changed).toBe(false);
        expect(fs.existsSync(first.projectConfigPath)).toBe(true);
        expect(fs.existsSync(first.statePath)).toBe(true);
        expect(fs.existsSync(first.claudeConfigPath)).toBe(true);
        expect(fs.existsSync(first.cursorConfigPath)).toBe(true);
        expect(fs.existsSync(first.codexConfigPath)).toBe(true);
        expect(first.claudeHookConfigured).toBe(true);
        expect(first.cursorHookConfigured).toBe(true);
        expect(first.codexNotifyConfigured).toBe(true);
        expect(fs.readFileSync(first.codexConfigPath, 'utf8')).not.toContain('--context-id=ctx-1');
        const claudeConfig = JSON.parse(fs.readFileSync(first.claudeConfigPath, 'utf8')) as {
            hooks?: {
                SessionStart?: Array<{ hooks?: Array<{ command?: string }> }>;
                Stop?: Array<{ hooks?: Array<{ command?: string }> }>;
                SubagentStop?: Array<{ hooks?: Array<{ command?: string }> }>;
            };
        };
        const claudeSessionStartCommands = (claudeConfig.hooks?.SessionStart ?? [])
            .flatMap(group => (group.hooks ?? []).map(entry => String(entry.command ?? '')));
        const claudeStopCommands = (claudeConfig.hooks?.Stop ?? [])
            .flatMap(group => (group.hooks ?? []).map(entry => String(entry.command ?? '')));
        const claudeSubagentCommands = (claudeConfig.hooks?.SubagentStop ?? [])
            .flatMap(group => (group.hooks ?? []).map(entry => String(entry.command ?? '')));
        expect(claudeSessionStartCommands.some(command => command.includes('hook session-start'))).toBe(true);
        expect(claudeStopCommands.some(command => command.includes('--agent=claude'))).toBe(true);
        expect(claudeSubagentCommands.some(command => command.includes('--agent=claude'))).toBe(true);
        expect(claudeSessionStartCommands.some(command => command.includes('--context-id='))).toBe(false);
        expect(claudeStopCommands.some(command => command.includes('--context-id='))).toBe(false);
        expect(claudeSubagentCommands.some(command => command.includes('--context-id='))).toBe(false);

        const persisted = readHookInstallState();
        expect(persisted.contextId).toBe('ctx-1');
        const claude = persisted.agents.find(agent => agent.agent === 'claude');
        const codex = persisted.agents.find(agent => agent.agent === 'codex');
        const windsurf = persisted.agents.find(agent => agent.agent === 'windsurf');
        const cursor = persisted.agents.find(agent => agent.agent === 'cursor');
        const factory = persisted.agents.find(agent => agent.agent === 'factory');
        const antigravity = persisted.agents.find(agent => agent.agent === 'antigravity');

        expect(claude?.installed).toBe(true);
        expect(String(claude?.command ?? '')).not.toContain('--repo-root');
        expect(String(claude?.command ?? '')).not.toContain('--context-id=');
        expect(codex?.installed).toBe(true);
        expect(String(codex?.command ?? '')).not.toContain('--repo-root');
        expect(String(codex?.command ?? '')).not.toContain('--context-id=');
        expect(windsurf?.installed).toBe(false);
        expect(cursor?.status).toBe('Supported');
        expect(cursor?.installed).toBe(true);
        expect(String(cursor?.command ?? '')).not.toContain('--repo-root');
        expect(String(cursor?.command ?? '')).not.toContain('--context-id=ctx-1');
        expect(String(cursor?.notes ?? '')).toContain('preview');
        expect(factory?.status).toBe('Skipped');
        expect(factory?.installed).toBe(false);
        expect(antigravity?.status).toBe('Skipped');
        expect(antigravity?.installed).toBe(false);
    });

    it('installs Claude SessionStart, Stop, and SubagentStop hooks without baking a context id', () => {
        const repoRoot = createTempDir();
        process.env.CTX_HOOK_STATE_PATH = path.join(repoRoot, '.0ctx', 'hooks-state.json');

        const result = installHooks({
            projectRoot: repoRoot,
            contextId: 'ctx-claude',
            clients: ['claude']
        });

        expect(result.claudeHookConfigured).toBe(true);
        expect(fs.existsSync(result.claudeConfigPath)).toBe(true);

        const parsed = JSON.parse(fs.readFileSync(result.claudeConfigPath, 'utf8')) as {
            hooks?: {
                SessionStart?: Array<{ hooks?: Array<{ type?: string; command?: string }> }>;
                Stop?: Array<{ hooks?: Array<{ type?: string; command?: string }> }>;
                SubagentStop?: Array<{ hooks?: Array<{ type?: string; command?: string }> }>;
            };
        };
        const sessionStartHooks = parsed.hooks?.SessionStart ?? [];
        const stopHooks = parsed.hooks?.Stop ?? [];
        const subagentStopHooks = parsed.hooks?.SubagentStop ?? [];

        expect(sessionStartHooks.length).toBeGreaterThan(0);
        expect(stopHooks.length).toBeGreaterThan(0);
        expect(subagentStopHooks.length).toBeGreaterThan(0);
        expect(
            sessionStartHooks.some(group =>
                (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('hook session-start --agent=claude'))
            )
        ).toBe(true);
        expect(
            stopHooks.some(group =>
                (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--agent=claude'))
            )
        ).toBe(true);
        expect(
            subagentStopHooks.some(group =>
                (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--agent=claude'))
            )
        ).toBe(true);
        expect(
            stopHooks.some(group =>
                (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--context-id='))
            )
        ).toBe(false);
        expect(
            sessionStartHooks.some(group =>
                (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--context-id='))
            )
        ).toBe(false);
        expect(
            subagentStopHooks.some(group =>
                (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--context-id='))
            )
        ).toBe(false);
    });

    it('installs Claude global hooks into the user settings file when requested', () => {
        const repoRoot = createTempDir();
        const fakeHome = createTempDir();
        process.env.HOME = fakeHome;
        process.env.USERPROFILE = fakeHome;
        process.env.CTX_HOOK_STATE_PATH = path.join(repoRoot, '.0ctx', 'hooks-state.json');

        const result = installHooks({
            projectRoot: repoRoot,
            contextId: 'ctx-claude',
            clients: ['claude'],
            installClaudeGlobal: true
        });

        expect(result.claudeGlobalHookConfigured).toBe(true);
        expect(fs.existsSync(result.claudeGlobalConfigPath)).toBe(true);

        const parsed = JSON.parse(fs.readFileSync(result.claudeGlobalConfigPath, 'utf8')) as {
            hooks?: {
                SessionStart?: Array<{ hooks?: Array<{ type?: string; command?: string }> }>;
                Stop?: Array<{ hooks?: Array<{ type?: string; command?: string }> }>;
                SubagentStop?: Array<{ hooks?: Array<{ type?: string; command?: string }> }>;
            };
        };
        const sessionStartHooks = parsed.hooks?.SessionStart ?? [];
        const stopHooks = parsed.hooks?.Stop ?? [];
        const subagentStopHooks = parsed.hooks?.SubagentStop ?? [];

        expect(sessionStartHooks.some(group =>
            (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('hook session-start --agent=claude'))
        )).toBe(true);
        expect(stopHooks.some(group =>
            (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--agent=claude'))
        )).toBe(true);
        expect(subagentStopHooks.some(group =>
            (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--agent=claude'))
        )).toBe(true);
        expect(stopHooks.some(group =>
            (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--context-id='))
        )).toBe(false);
        expect(sessionStartHooks.some(group =>
            (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--context-id='))
        )).toBe(false);
        expect(subagentStopHooks.some(group =>
            (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--context-id='))
        )).toBe(false);
    });

    it('installs Windsurf hooks file with prompt and response events', () => {
        const repoRoot = createTempDir();
        process.env.CTX_HOOK_STATE_PATH = path.join(repoRoot, '.0ctx', 'hooks-state.json');

        const result = installHooks({
            projectRoot: repoRoot,
            clients: ['windsurf']
        });

        expect(result.windsurfHookConfigured).toBe(true);
        expect(fs.existsSync(result.windsurfConfigPath)).toBe(true);

        const parsed = JSON.parse(fs.readFileSync(result.windsurfConfigPath, 'utf8')) as {
            hooks?: Record<string, Array<{ command?: string }>>;
        };
        const hookEntries = parsed.hooks?.post_cascade_response ?? [];
        const promptEntries = parsed.hooks?.pre_user_prompt ?? [];
        expect(hookEntries.length).toBeGreaterThan(0);
        expect(promptEntries.length).toBeGreaterThan(0);
        expect(hookEntries.some(entry => String(entry.command ?? '').includes('--agent=windsurf'))).toBe(true);
        expect(promptEntries.some(entry => String(entry.command ?? '').includes('--agent=windsurf'))).toBe(true);
        expect(hookEntries.some(entry => String(entry.command ?? '').includes('--context-id='))).toBe(false);
        expect(promptEntries.some(entry => String(entry.command ?? '').includes('--context-id='))).toBe(false);
    });

    it('installs Factory hook into .factory settings', () => {
        const repoRoot = createTempDir();
        process.env.CTX_HOOK_STATE_PATH = path.join(repoRoot, '.0ctx', 'hooks-state.json');

        const result = installHooks({
            projectRoot: repoRoot,
            clients: ['factory']
        });

        expect(result.factoryHookConfigured).toBe(true);
        expect(fs.existsSync(result.factoryConfigPath)).toBe(true);

        const parsed = JSON.parse(fs.readFileSync(result.factoryConfigPath, 'utf8')) as {
            hooks?: {
                SessionStart?: Array<{
                    hooks?: Array<{ type?: string; command?: string }>;
                }>;
                Stop?: Array<{
                    hooks?: Array<{ type?: string; command?: string }>;
                }>;
                SubagentStop?: Array<{
                    hooks?: Array<{ type?: string; command?: string }>;
                }>;
            };
        };
        const sessionStartHooks = parsed.hooks?.SessionStart ?? [];
        const stopHooks = parsed.hooks?.Stop ?? [];
        const subagentStopHooks = parsed.hooks?.SubagentStop ?? [];

        expect(sessionStartHooks.length).toBeGreaterThan(0);
        expect(stopHooks.length).toBeGreaterThan(0);
        expect(subagentStopHooks.length).toBeGreaterThan(0);
        expect(
            sessionStartHooks.some(group =>
                (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('hook session-start --agent=factory'))
            )
        ).toBe(true);
        expect(
            stopHooks.some(group =>
                (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--agent=factory'))
            )
        ).toBe(true);
        expect(
            subagentStopHooks.some(group =>
                (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--agent=factory'))
            )
        ).toBe(true);
        expect(
            stopHooks.some(group =>
                (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--context-id='))
            )
        ).toBe(false);
        expect(
            sessionStartHooks.some(group =>
                (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--context-id='))
            )
        ).toBe(false);
    });

    it('installs Antigravity hook into .gemini settings', () => {
        const repoRoot = createTempDir();
        process.env.CTX_HOOK_STATE_PATH = path.join(repoRoot, '.0ctx', 'hooks-state.json');

        const result = installHooks({
            projectRoot: repoRoot,
            clients: ['antigravity']
        });

        expect(result.antigravityHookConfigured).toBe(true);
        expect(fs.existsSync(result.antigravityConfigPath)).toBe(true);

        const parsed = JSON.parse(fs.readFileSync(result.antigravityConfigPath, 'utf8')) as {
            hooks?: {
                SessionStart?: Array<{
                    matcher?: string;
                    hooks?: Array<{ type?: string; command?: string }>;
                }>;
                Stop?: Array<{
                    matcher?: string;
                    hooks?: Array<{ type?: string; command?: string }>;
                }>;
                SubagentStop?: Array<{
                    matcher?: string;
                    hooks?: Array<{ type?: string; command?: string }>;
                }>;
            };
        };
        const sessionStartHooks = parsed.hooks?.SessionStart ?? [];
        const stopHooks = parsed.hooks?.Stop ?? [];
        const subagentStopHooks = parsed.hooks?.SubagentStop ?? [];

        expect(sessionStartHooks.length).toBeGreaterThan(0);
        expect(stopHooks.length).toBeGreaterThan(0);
        expect(subagentStopHooks.length).toBeGreaterThan(0);
        expect(
            sessionStartHooks.some(group =>
                group.matcher === '*'
                && (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('hook session-start --agent=antigravity'))
            )
        ).toBe(true);
        expect(
            stopHooks.some(group =>
                group.matcher === '*'
                && (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--agent=antigravity'))
            )
        ).toBe(true);
        expect(
            subagentStopHooks.some(group =>
                group.matcher === '*'
                && (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--agent=antigravity'))
            )
        ).toBe(true);
        expect(
            sessionStartHooks.some(group =>
                (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--context-id='))
            )
        ).toBe(false);
        expect(
            stopHooks.some(group =>
                (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--repo-root'))
            )
        ).toBe(false);
        expect(
            stopHooks.some(group =>
                (group.hooks ?? []).some(entry => String(entry.command ?? '').includes('--context-id='))
            )
        ).toBe(false);
    });

    it('falls back to repo path matching when an explicit hook context id is stale', () => {
        const repoRoot = createTempDir();
        const selected = selectHookContextId(
            [
                {
                    id: 'ctx-current',
                    paths: [repoRoot]
                }
            ],
            repoRoot,
            'ctx-deleted'
        );

        expect(selected).toBe('ctx-current');
    });

    it('does not fall back to the only context when no repo path matches', () => {
        const repoRoot = createTempDir();
        const selected = selectHookContextId(
            [
                {
                    id: 'ctx-only',
                    paths: [path.join(repoRoot, 'other-repo')]
                }
            ],
            repoRoot,
            null
        );

        expect(selected).toBeNull();
    });

    it('cleans legacy managed commands from .factory/settings.local.json', () => {
        const repoRoot = createTempDir();
        process.env.CTX_HOOK_STATE_PATH = path.join(repoRoot, '.0ctx', 'hooks-state.json');
        const localConfigPath = path.join(repoRoot, '.factory', 'settings.local.json');
        fs.mkdirSync(path.dirname(localConfigPath), { recursive: true });
        fs.writeFileSync(localConfigPath, JSON.stringify({
            hooks: {
                SessionStart: [
                    {
                        hooks: [
                            {
                                type: 'command',
                                command: '0ctx hook session-start --agent=factory'
                            }
                        ]
                    }
                ],
                Stop: [
                    {
                        hooks: [
                            {
                                type: 'command',
                                command: '0ctx hook ingest --agent=antigravity --repo-root="C:\\\\tmp"'
                            },
                            {
                                type: 'command',
                                command: 'echo keep-me'
                            }
                        ]
                    }
                ],
                SubagentStop: [
                    {
                        hooks: [
                            {
                                type: 'command',
                                command: '0ctx hook ingest --agent=factory --repo-root="C:\\\\tmp"'
                            }
                        ]
                    }
                ]
            }
        }, null, 2), 'utf8');

        installHooks({
            projectRoot: repoRoot,
            clients: ['factory']
        });

        const localConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf8')) as {
            hooks?: {
                SessionStart?: Array<{ hooks?: Array<{ command?: string }> }>;
                Stop?: Array<{ hooks?: Array<{ command?: string }> }>;
                SubagentStop?: Array<{ hooks?: Array<{ command?: string }> }>;
            };
        };
        const sessionStartCommands = (localConfig.hooks?.SessionStart ?? [])
            .flatMap(group => (group.hooks ?? []).map(entry => String(entry.command ?? '')));
        const stopCommands = (localConfig.hooks?.Stop ?? [])
            .flatMap(group => (group.hooks ?? []).map(entry => String(entry.command ?? '')));
        const subagentCommands = (localConfig.hooks?.SubagentStop ?? [])
            .flatMap(group => (group.hooks ?? []).map(entry => String(entry.command ?? '')));

        expect(sessionStartCommands.some(command => command.includes('hook session-start'))).toBe(false);
        expect(stopCommands.some(command => command.includes('keep-me'))).toBe(true);
        expect(stopCommands.some(command => command.includes('--agent=antigravity'))).toBe(false);
        expect(subagentCommands.some(command => command.includes('--agent=factory'))).toBe(false);
    });

    it('cleans legacy managed commands from the home .factory/settings.json', () => {
        const repoRoot = createTempDir();
        const fakeHome = createTempDir();
        process.env.HOME = fakeHome;
        process.env.USERPROFILE = fakeHome;
        process.env.CTX_HOOK_STATE_PATH = path.join(repoRoot, '.0ctx', 'hooks-state.json');

        const homeConfigPath = path.join(fakeHome, '.factory', 'settings.json');
        fs.mkdirSync(path.dirname(homeConfigPath), { recursive: true });
        fs.writeFileSync(homeConfigPath, JSON.stringify({
            hooks: {
                SessionStart: [
                    {
                        hooks: [
                            {
                                type: 'command',
                                command: '0ctx hook session-start --agent=factory'
                            }
                        ]
                    }
                ],
                Stop: [
                    {
                        hooks: [
                            {
                                type: 'command',
                                command: '0ctx hook ingest --quiet --agent=factory --context-id=ctx-home'
                            },
                            {
                                type: 'command',
                                command: 'echo keep-stop'
                            }
                        ]
                    }
                ],
                SubagentStop: [
                    {
                        hooks: [
                            {
                                type: 'command',
                                command: '0ctx hook ingest --quiet --agent=factory --context-id=ctx-home'
                            }
                        ]
                    }
                ]
            }
        }, null, 2), 'utf8');

        installHooks({
            projectRoot: repoRoot,
            contextId: 'ctx-project',
            clients: ['factory']
        });

        const homeConfig = JSON.parse(fs.readFileSync(homeConfigPath, 'utf8')) as {
            hooks?: {
                SessionStart?: Array<{ hooks?: Array<{ command?: string }> }>;
                Stop?: Array<{ hooks?: Array<{ command?: string }> }>;
                SubagentStop?: Array<{ hooks?: Array<{ command?: string }> }>;
            };
        };
        const sessionStartCommands = (homeConfig.hooks?.SessionStart ?? [])
            .flatMap(group => (group.hooks ?? []).map(entry => String(entry.command ?? '')));
        const stopCommands = (homeConfig.hooks?.Stop ?? [])
            .flatMap(group => (group.hooks ?? []).map(entry => String(entry.command ?? '')));
        const subagentCommands = (homeConfig.hooks?.SubagentStop ?? [])
            .flatMap(group => (group.hooks ?? []).map(entry => String(entry.command ?? '')));

        expect(sessionStartCommands.some(command => command.includes('hook session-start'))).toBe(false);
        expect(stopCommands.some(command => command.includes('keep-stop'))).toBe(true);
        expect(stopCommands.some(command => command.includes('hook ingest'))).toBe(false);
        expect(subagentCommands.some(command => command.includes('hook ingest'))).toBe(false);
    });

    it('cleans legacy managed commands from the home .gemini/settings.json', () => {
        const repoRoot = createTempDir();
        const fakeHome = createTempDir();
        process.env.HOME = fakeHome;
        process.env.USERPROFILE = fakeHome;
        process.env.CTX_HOOK_STATE_PATH = path.join(repoRoot, '.0ctx', 'hooks-state.json');

        const homeConfigPath = path.join(fakeHome, '.gemini', 'settings.json');
        fs.mkdirSync(path.dirname(homeConfigPath), { recursive: true });
        fs.writeFileSync(homeConfigPath, JSON.stringify({
            hooks: {
                SessionStart: [
                    {
                        matcher: '*',
                        hooks: [
                            {
                                type: 'command',
                                command: '0ctx hook session-start --agent=antigravity'
                            }
                        ]
                    }
                ],
                Stop: [
                    {
                        matcher: '*',
                        hooks: [
                            {
                                type: 'command',
                                command: '0ctx hook ingest --quiet --agent=antigravity --context-id=ctx-home'
                            },
                            {
                                type: 'command',
                                command: 'echo keep-stop'
                            }
                        ]
                    }
                ],
                SubagentStop: [
                    {
                        matcher: '*',
                        hooks: [
                            {
                                type: 'command',
                                command: '0ctx hook ingest --quiet --agent=antigravity --context-id=ctx-home'
                            }
                        ]
                    }
                ]
            }
        }, null, 2), 'utf8');

        installHooks({
            projectRoot: repoRoot,
            contextId: 'ctx-project',
            clients: ['antigravity']
        });

        const homeConfig = JSON.parse(fs.readFileSync(homeConfigPath, 'utf8')) as {
            hooks?: {
                SessionStart?: Array<{ hooks?: Array<{ command?: string }> }>;
                Stop?: Array<{ hooks?: Array<{ command?: string }> }>;
                SubagentStop?: Array<{ hooks?: Array<{ command?: string }> }>;
            };
        };
        const sessionStartCommands = (homeConfig.hooks?.SessionStart ?? [])
            .flatMap(group => (group.hooks ?? []).map(entry => String(entry.command ?? '')));
        const stopCommands = (homeConfig.hooks?.Stop ?? [])
            .flatMap(group => (group.hooks ?? []).map(entry => String(entry.command ?? '')));
        const subagentCommands = (homeConfig.hooks?.SubagentStop ?? [])
            .flatMap(group => (group.hooks ?? []).map(entry => String(entry.command ?? '')));

        expect(sessionStartCommands.some(command => command.includes('hook session-start'))).toBe(false);
        expect(stopCommands.some(command => command.includes('keep-stop'))).toBe(true);
        expect(stopCommands.some(command => command.includes('hook ingest'))).toBe(false);
        expect(subagentCommands.some(command => command.includes('hook ingest'))).toBe(false);
    });

    it('does not overwrite existing codex notify and reports a warning', () => {
        const repoRoot = createTempDir();
        const codexConfigPath = path.join(repoRoot, '.codex', 'config.toml');
        process.env.CTX_HOOK_STATE_PATH = path.join(repoRoot, '.0ctx', 'hooks-state.json');

        fs.mkdirSync(path.dirname(codexConfigPath), { recursive: true });
        fs.writeFileSync(codexConfigPath, 'notify = ["echo", "existing"]\n', 'utf8');

        const result = installHooks({
            projectRoot: repoRoot,
            clients: ['codex']
        });

        expect(result.codexNotifyConfigured).toBe(false);
        expect(result.warnings.length).toBeGreaterThan(0);

        const state = readHookInstallState();
        const codex = state.agents.find(agent => agent.agent === 'codex');
        expect(codex?.installed).toBe(false);
        expect(codex?.status).toBe('Skipped');
        expect(fs.readFileSync(codexConfigPath, 'utf8')).toBe('notify = ["echo", "existing"]\n');
    });

    it('normalizes adapter payloads for claude, windsurf, codex, cursor, and factory', () => {
        const transcriptDir = createTempDir();
        const transcriptPath = path.join(transcriptDir, 'factory-transcript.jsonl');
        fs.writeFileSync(transcriptPath, [
            JSON.stringify({
                type: 'session_start',
                id: 'factory-session-1',
                title: 'hi',
                sessionTitle: 'User Greeting and Introduction',
                cwd: 'C:\\repo'
            }),
            JSON.stringify({
                type: 'message',
                message: {
                    role: 'user',
                    content: [
                        { type: 'text', text: '<system-reminder>ignore me</system-reminder>' },
                        { type: 'text', text: 'what this app is about?' }
                    ]
                }
            }),
            JSON.stringify({
                type: 'message',
                message: {
                    role: 'assistant',
                    content: [
                        { type: 'thinking', text: 'internal' },
                        { type: 'text', text: 'I do not see a specific project in the current directory.' }
                    ]
                }
            })
        ].join('\n'), 'utf8');

        const claude = normalizeHookPayload('claude', {
            session_id: 'claude-s1',
            message_id: 'm-1',
            last_assistant_message: '  Claude produced a detailed answer.  ',
            timestamp: 1700000000
        }, 1);
        expect(claude.sessionId).toBe('claude-s1');
        expect(claude.turnId).toBe('m-1');
        expect(claude.role).toBe('assistant');
        expect(claude.summary).toContain('Claude produced a detailed answer.');
        expect(claude.occurredAt).toBe(1700000000000);

        const claudeTranscript = normalizeHookPayload('claude', {
            session_id: 'claude-s2',
            agent_transcript_path: transcriptPath,
            timestamp: 1700000001
        }, 1);
        expect(claudeTranscript.summary).toContain('what this app is about?');
        expect(claudeTranscript.raw.cwd).toBe('C:\\repo');
        expect(claudeTranscript.raw.sessionTitle).toBe('hi');

        const windsurf = normalizeHookPayload('windsurf', {
            trajectory_id: 'wind-ctx-9',
            execution_id: 'turn-77',
            agent_action_name: 'post_cascade_response',
            tool_info: {
                response: 'Refactor this module in incremental steps'
            },
            timestamp: '2026-01-02T03:04:05.000Z'
        }, 1);
        expect(windsurf.sessionId).toBe('wind-ctx-9');
        expect(windsurf.turnId).toBe('turn-77');
        expect(windsurf.role).toBe('assistant');
        expect(windsurf.summary).toContain('Refactor this module');

        const codex = normalizeHookPayload('codex', {
            'thread-id': 'codex-thread-1',
            'turn-id': 'codex-turn-9',
            'last-assistant-message': 'Final summary from Codex',
            type: 'agent-turn-complete',
            createdAt: 1700000000123
        }, 1);
        expect(codex.sessionId).toBe('codex-thread-1');
        expect(codex.turnId).toBe('codex-turn-9');
        expect(codex.role).toBe('assistant');
        expect(codex.summary).toContain('Final summary from Codex');
        expect(codex.occurredAt).toBe(1700000000123);

        const cursor = normalizeHookPayload('cursor', {
            conversation_id: 'cursor-thread-1',
            generation_id: 'cursor-turn-2',
            response: 'Cursor generated a patch',
            timestamp: 1700001234
        }, 1);
        expect(cursor.sessionId).toBe('cursor-thread-1');
        expect(cursor.turnId).toBe('cursor-turn-2');
        expect(cursor.role).toBe('assistant');
        expect(cursor.summary).toContain('Cursor generated a patch');
        expect(cursor.occurredAt).toBe(1700001234000);

        const factory = normalizeHookPayload('factory', {
            session_id: 'factory-session-1',
            stop_reason: 'end_turn',
            transcript_path: transcriptPath,
            timestamp: 1700002000
        }, 1);
        expect(factory.sessionId).toBe('factory-session-1');
        expect(factory.turnId).toBe('turn-1700002000000');
        expect(factory.role).toBe('assistant');
        expect(factory.summary).toContain('what this app is about?');
        expect(factory.summary).toContain('I do not see a specific project');
        expect(factory.summary).not.toContain('factory-transcript.jsonl');
        expect(factory.raw.cwd).toBe('C:\\repo');
        expect(factory.raw.sessionTitle).toBe('hi');

        const nested = normalizeHookPayload('factory', {
            session: { id: 'nested-session-1' },
            turn: { id: 'nested-turn-1' },
            content: 'nested payload content',
            timestamp: 1700002002
        }, 1);
        expect(nested.sessionId).toBe('nested-session-1');
        expect(nested.turnId).toBe('nested-turn-1');
        expect(nested.summary).toContain('nested payload content');

        const antigravityAlias = normalizeHookPayload('antigravity', {
            session_id: 'factory-session-2',
            stop_reason: 'end_turn',
            transcript_path: transcriptPath,
            timestamp: 1700002001
        }, 1);
        expect(antigravityAlias.summary).toContain('what this app is about?');
    });

    it('reads transcript messages with stable ids and visible text only', () => {
        const transcriptDir = createTempDir();
        const transcriptPath = path.join(transcriptDir, 'factory-transcript.jsonl');
        fs.writeFileSync(transcriptPath, [
            JSON.stringify({
                type: 'session_start',
                id: 'factory-session-2',
                title: 'hello',
                cwd: 'C:\\repo'
            }),
            JSON.stringify({
                type: 'message',
                id: 'msg-user-1',
                timestamp: '2026-03-06T05:00:00.000Z',
                message: {
                    role: 'user',
                    content: [
                        { type: 'text', text: '<system-reminder>ignore me</system-reminder>' },
                        { type: 'text', text: 'show me the folder structure' }
                    ]
                }
            }),
            JSON.stringify({
                type: 'message',
                id: 'msg-assistant-1',
                timestamp: '2026-03-06T05:00:03.000Z',
                message: {
                    role: 'assistant',
                    content: [
                        { type: 'thinking', text: 'not visible' },
                        { type: 'text', text: 'Here is the main package layout.' }
                    ]
                },
                parentId: 'msg-user-1'
            }),
            JSON.stringify({
                type: 'message',
                id: 'msg-tool-only',
                timestamp: '2026-03-06T05:00:04.000Z',
                message: {
                    role: 'user',
                    content: [
                        { type: 'tool_result', content: 'ignored tool output' }
                    ]
                }
            })
        ].join('\n'), 'utf8');

        const capture = readTranscriptCapture(transcriptPath);

        expect(capture.cwd).toBe('C:\\repo');
        expect(capture.sessionTitle).toBe('hello');
        expect(capture.messages).toHaveLength(2);
        expect(capture.messages[0]).toMatchObject({
            messageId: 'msg-user-1',
            role: 'user',
            text: 'show me the folder structure',
            lineNumber: 2
        });
        expect(capture.messages[1]).toMatchObject({
            messageId: 'msg-assistant-1',
            role: 'assistant',
            text: 'Here is the main package layout.',
            parentId: 'msg-user-1',
            lineNumber: 3
        });
        expect(capture.summary).toBe('show me the folder structure -> Here is the main package layout.');
        expect(capture.startedAt).toBe(Date.parse('2026-03-06T05:00:00.000Z'));
    });

    it('derives a turn-scoped Codex capture from inline notify payloads', () => {
        const occurredAt = Date.parse('2026-03-06T05:10:00.000Z');
        const capture = readCodexCapture({
            cwd: 'C:\\repo',
            'thread-title': 'Implement branch lanes',
            'input-messages': [
                { role: 'system', content: [{ type: 'text', text: 'internal' }] },
                { role: 'user', content: [{ type: 'text', text: 'please add branch checkpoints' }] }
            ],
            'last-assistant-message': 'Branch checkpoints are now a first-class primitive.'
        }, {
            sessionId: 'codex-session-1',
            turnId: 'codex-turn-2',
            occurredAt
        });

        expect(capture.cwd).toBe('C:\\repo');
        expect(capture.sessionTitle).toBe('Implement branch lanes');
        expect(capture.summary).toBe('please add branch checkpoints -> Branch checkpoints are now a first-class primitive.');
        expect(capture.messages).toHaveLength(2);
        expect(capture.messages[0]).toMatchObject({
            messageId: 'codex-turn-2:user',
            role: 'user',
            text: 'please add branch checkpoints'
        });
        expect(capture.messages[1]).toMatchObject({
            messageId: 'codex-turn-2:assistant',
            role: 'assistant',
            parentId: 'codex-turn-2:user',
            text: 'Branch checkpoints are now a first-class primitive.'
        });
    });

    it('resolves and reads Codex session archives as the capture source of truth', () => {
        const fakeHome = createTempDir();
        process.env.HOME = fakeHome;
        process.env.USERPROFILE = fakeHome;

        const sessionId = 'codex-session-archive-1';
        const archivePath = path.join(fakeHome, '.codex', 'sessions', '2026', '03', '07', 'rollout-2026-03-07T10-00-00-other-name.jsonl');
        fs.mkdirSync(path.dirname(archivePath), { recursive: true });
        fs.writeFileSync(path.join(fakeHome, '.codex', 'session_index.jsonl'), JSON.stringify({
            id: sessionId,
            thread_name: 'Codex archive test',
            updated_at: '2026-03-07T10:00:09.000Z'
        }) + '\n', 'utf8');
        fs.writeFileSync(archivePath, [
            JSON.stringify({
                type: 'session_meta',
                payload: {
                    id: sessionId,
                    cwd: 'C:\\repo',
                    thread_name: 'Codex archive test'
                }
            }),
            JSON.stringify({
                type: 'response_item',
                timestamp: '2026-03-07T10:00:00.000Z',
                payload: {
                    id: 'msg-user-1',
                    type: 'message',
                    role: 'user',
                    content: [{ type: 'input_text', text: 'please use the archive' }]
                }
            }),
            JSON.stringify({
                type: 'response_item',
                timestamp: '2026-03-07T10:00:05.000Z',
                payload: {
                    id: 'msg-dev-1',
                    type: 'message',
                    role: 'developer',
                    content: [{ type: 'input_text', text: 'internal guidance' }]
                }
            }),
            JSON.stringify({
                type: 'response_item',
                timestamp: '2026-03-07T10:00:08.000Z',
                payload: {
                    id: 'msg-assistant-1',
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: 'The archive is now the capture source of truth.' }]
                }
            })
        ].join('\n'), 'utf8');

        const resolved = resolveCodexSessionArchivePath({}, sessionId);
        expect(resolved).toBe(archivePath);

        const capture = readCodexArchiveCapture(resolved, {
            sessionId,
            occurredAt: Date.parse('2026-03-07T10:00:10.000Z')
        });

        expect(capture.cwd).toBe('C:\\repo');
        expect(capture.sessionTitle).toBe('Codex archive test');
        expect(capture.summary).toBe('please use the archive -> The archive is now the capture source of truth.');
        expect(capture.messages).toHaveLength(2);
        expect(capture.messages[0]).toMatchObject({
            messageId: 'msg-user-1',
            role: 'user',
            text: 'please use the archive'
        });
        expect(capture.messages[1]).toMatchObject({
            messageId: 'msg-assistant-1',
            role: 'assistant',
            parentId: 'msg-user-1',
            text: 'The archive is now the capture source of truth.'
        });
    });

    it('derives inline hook captures for Claude, Windsurf, and Cursor events', () => {
        const occurredAt = Date.parse('2026-03-06T06:00:00.000Z');

        const claude = readInlineHookCapture('claude', {
            cwd: 'C:\\repo',
            hook_event_name: 'Stop',
            last_assistant_message: 'Claude finished the hook capture integration.'
        }, {
            sessionId: 'claude-session-1',
            turnId: 'claude-turn-1',
            occurredAt
        });

        expect(claude.messages).toHaveLength(1);
        expect(claude.messages[0]).toMatchObject({
            messageId: 'claude-turn-1:assistant',
            role: 'assistant',
            text: 'Claude finished the hook capture integration.'
        });

        const windsurf = readInlineHookCapture('windsurf', {
            cwd: 'C:\\repo',
            event: 'post_cascade_response',
            trajectory_id: 'wind-session-1',
            execution_id: 'wind-turn-1',
            tool_info: {
                response: 'Windsurf finished the branch lane refactor.'
            }
        }, {
            sessionId: 'wind-session-1',
            turnId: 'wind-turn-1',
            occurredAt
        });

        expect(windsurf.messages).toHaveLength(1);
        expect(windsurf.messages[0]).toMatchObject({
            messageId: 'wind-turn-1:assistant',
            role: 'assistant',
            text: 'Windsurf finished the branch lane refactor.'
        });

        const cursor = readInlineHookCapture('cursor', {
            cwd: 'C:\\repo',
            event: 'beforeSubmitPrompt',
            conversation_id: 'cursor-session-1',
            generation_id: 'cursor-turn-1',
            prompt: 'please summarize the active branch'
        }, {
            sessionId: 'cursor-session-1',
            turnId: 'cursor-turn-1',
            occurredAt
        });

        expect(cursor.messages).toHaveLength(1);
        expect(cursor.messages[0]).toMatchObject({
            messageId: 'cursor-turn-1:user',
            role: 'user',
            text: 'please summarize the active branch'
        });
    });

    it('resolves capture roots and matches them against workspace paths', () => {
        const repoRoot = createTempDir();
        const subdir = path.join(repoRoot, 'packages', 'app');
        const outsideRoot = createTempDir();
        const parentRoot = path.dirname(repoRoot);
        fs.mkdirSync(subdir, { recursive: true });

        expect(resolveHookCaptureRoot('factory', {
            cwd: subdir,
            meta: {
                repositoryRoot: repoRoot
            }
        }, outsideRoot)).toBe(path.resolve(repoRoot));
        expect(resolveHookCaptureRoot('antigravity', {
            cwd: subdir
        }, outsideRoot)).toBe(path.resolve(subdir));
        expect(resolveHookCaptureRoot('codex', {
            cwd: subdir
        }, outsideRoot)).toBe(path.resolve(subdir));
        expect(matchesHookCaptureRoot([repoRoot], subdir)).toBe(true);
        expect(matchesHookCaptureRoot([repoRoot], repoRoot)).toBe(true);
        expect(matchesHookCaptureRoot([repoRoot], parentRoot)).toBe(false);
        expect(matchesHookCaptureRoot([repoRoot], outsideRoot)).toBe(false);
    });

    it('returns stable per-agent config paths for hook health checks', () => {
        const repoRoot = createTempDir();

        expect(getHookConfigPath(repoRoot, 'claude')).toBe(path.join(repoRoot, '.claude', 'settings.local.json'));
        expect(getHookConfigPath(repoRoot, 'codex')).toBe(path.join(repoRoot, '.codex', 'config.toml'));
        expect(getHookConfigPath(repoRoot, 'factory')).toBe(path.join(repoRoot, '.factory', 'settings.json'));
    });
});
