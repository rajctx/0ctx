import path from 'path';
import type { HookSupportedAgent } from '../../../hooks';
import type { HookArtifactPaths } from './types';

interface HookSupportDeps {
    sendToDaemon: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
    selectHookContextId: (contexts: Array<{ id?: string; paths?: string[] }>, repoRoot: string, preferredContextId: string | null) => string | null;
    resolveHookCaptureRoot: (agent: HookSupportedAgent, payload: Record<string, unknown>, repoRoot: string | null) => string | null;
    matchesHookCaptureRoot: (contextPaths: string[] | undefined, captureRoot: string | null) => boolean;
}

export function extractSupportedHookAgent(raw: string | null): HookSupportedAgent | null {
    if (raw === 'claude' || raw === 'windsurf' || raw === 'codex' || raw === 'cursor' || raw === 'factory' || raw === 'antigravity') {
        return raw;
    }
    return null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

export function buildHookCaptureMeta(options: {
    agent: HookSupportedAgent;
    sessionId: string;
    turnId: string;
    role: string;
    occurredAt: number;
    branch: string | null;
    commitSha: string | null;
    repositoryRoot: string;
    artifacts: HookArtifactPaths;
    extra?: Record<string, unknown>;
}): Record<string, unknown> {
    return {
        agent: options.agent,
        sessionId: options.sessionId,
        turnId: options.turnId,
        role: options.role,
        occurredAt: options.occurredAt,
        branch: options.branch,
        commitSha: options.commitSha,
        repositoryRoot: options.repositoryRoot,
        hookDumpPath: options.artifacts.dumpPath,
        hookEventLogPath: options.artifacts.hookEventLogPath,
        transcriptDumpPath: options.artifacts.transcriptDumpPath,
        transcriptHistoryPath: options.artifacts.transcriptHistoryPath,
        transcriptSourcePath: options.artifacts.transcriptSourcePath,
        ...(options.extra ?? {})
    };
}

export function createHookSupport(deps: HookSupportDeps) {
    async function resolveContextIdForHookIngest(repoRoot: string, explicitContextId: string | null): Promise<string | null> {
        const contexts = await deps.sendToDaemon('listContexts', {}) as Array<{ id: string; paths?: string[] }>;
        return deps.selectHookContextId(contexts, repoRoot, explicitContextId);
    }

    async function resolveHookContextPaths(contextId: string): Promise<string[] | null> {
        const contexts = await deps.sendToDaemon('listContexts', {}) as Array<{ id?: string; paths?: string[] }>;
        const matched = Array.isArray(contexts)
            ? contexts.find(context => typeof context?.id === 'string' && context.id === contextId)
            : null;
        if (!matched) return null;
        return Array.isArray(matched.paths)
            ? matched.paths.filter((rawPath): rawPath is string => typeof rawPath === 'string' && rawPath.trim().length > 0)
            : [];
    }

    async function validateHookIngestWorkspace(options: {
        agent: HookSupportedAgent;
        contextId: string;
        repoRoot: string;
        payload: Record<string, unknown>;
    }): Promise<{ ok: boolean; captureRoot: string; error: string | null }> {
        const captureRoot = deps.resolveHookCaptureRoot(options.agent, options.payload, options.repoRoot) ?? path.resolve(options.repoRoot);
        const contextPaths = await resolveHookContextPaths(options.contextId);
        if (contextPaths === null) {
            return {
                ok: false,
                captureRoot,
                error: `connector_hook_ingest_context_missing: context '${options.contextId}' was not found.`
            };
        }
        if (contextPaths.length === 0 || deps.matchesHookCaptureRoot(contextPaths, captureRoot)) {
            return { ok: true, captureRoot, error: null };
        }
        return {
            ok: false,
            captureRoot,
            error: `connector_hook_ingest_workspace_mismatch: capture path '${captureRoot}' is outside the bound workspace paths for context '${options.contextId}' (${contextPaths.join(', ')}).`
        };
    }

    async function ensureChatSessionNode(options: {
        contextId: string;
        agent: HookSupportedAgent;
        sessionId: string;
        summary: string;
        startedAt: number;
        branch: string | null;
        commitSha: string | null;
        repositoryRoot: string;
        artifacts: HookArtifactPaths;
        sessionTitle?: string | null;
    }): Promise<{ id?: string; content?: string } | null> {
        const sessionKey = `chat_session:${options.agent}:${options.sessionId}`;
        let sessionNode = await deps.sendToDaemon('getByKey', {
            contextId: options.contextId,
            key: sessionKey,
            includeHidden: true
        }) as { id?: string; content?: string } | null;

        if (!sessionNode?.id) {
            sessionNode = await deps.sendToDaemon('addNode', {
                contextId: options.contextId,
                type: 'artifact',
                hidden: true,
                thread: options.sessionId,
                key: sessionKey,
                tags: ['chat_session', `agent:${options.agent}`],
                source: `hook:${options.agent}`,
                content: options.summary,
                createdAtOverride: options.startedAt,
                rawPayload: {
                    agent: options.agent,
                    sessionId: options.sessionId,
                    sessionTitle: options.sessionTitle ?? null,
                    branch: options.branch,
                    commitSha: options.commitSha,
                    repositoryRoot: options.repositoryRoot,
                    meta: buildHookCaptureMeta({
                        agent: options.agent,
                        sessionId: options.sessionId,
                        turnId: `session-${options.sessionId}`,
                        role: 'session',
                        occurredAt: options.startedAt,
                        branch: options.branch,
                        commitSha: options.commitSha,
                        repositoryRoot: options.repositoryRoot,
                        artifacts: options.artifacts,
                        extra: { sessionTitle: options.sessionTitle ?? null }
                    })
                }
            }) as { id?: string; content?: string } | null;
        } else if (sessionNode.content !== options.summary) {
            sessionNode = await deps.sendToDaemon('updateNode', {
                id: sessionNode.id,
                updates: { content: options.summary, hidden: true }
            }) as { id?: string; content?: string } | null;
        }

        return sessionNode;
    }

    async function ensureChatCommitNode(options: {
        contextId: string;
        agent: HookSupportedAgent;
        branch: string | null;
        commitSha: string | null;
        repositoryRoot: string;
    }): Promise<{ id?: string } | null> {
        if (!options.commitSha) return null;
        const commitKey = `chat_commit:${options.branch ?? 'detached'}:${options.commitSha}`;
        let commitNode = await deps.sendToDaemon('getByKey', {
            contextId: options.contextId,
            key: commitKey,
            includeHidden: true
        }) as { id?: string } | null;
        if (commitNode?.id) return commitNode;

        commitNode = await deps.sendToDaemon('addNode', {
            contextId: options.contextId,
            type: 'artifact',
            hidden: true,
            key: commitKey,
            tags: ['chat_commit', `branch:${options.branch ?? 'detached'}`],
            source: `hook:${options.agent}`,
            content: `Commit ${options.commitSha.slice(0, 12)} on ${options.branch ?? 'detached'}`,
            rawPayload: {
                branch: options.branch,
                commitSha: options.commitSha,
                repositoryRoot: options.repositoryRoot
            }
        }) as { id?: string } | null;
        return commitNode;
    }

    return {
        resolveContextIdForHookIngest,
        validateHookIngestWorkspace,
        ensureChatSessionNode,
        ensureChatCommitNode
    };
}
