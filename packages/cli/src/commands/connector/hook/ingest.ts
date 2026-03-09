import type { HookSupportedAgent } from '../../../cli-core/types';
import type { HookCommandDeps, FlagMap, HookArtifactPaths } from './types';

function parsePayloadText(deps: HookCommandDeps, flags: FlagMap): string {
    const inputFile = deps.parseOptionalStringFlag(flags['input-file']);
    const inlinePayload = deps.parseOptionalStringFlag(flags.payload);
    return inputFile
        ? require('fs').readFileSync(require('path').resolve(inputFile), 'utf8')
        : inlinePayload ?? deps.readStdinPayload();
}

function parsePayload(rawText: string): unknown {
    try {
        return JSON.parse(rawText);
    } catch {
        return { content: rawText };
    }
}

function resolveTranscriptCapture(
    deps: HookCommandDeps,
    agent: HookSupportedAgent,
    normalizedRaw: Record<string, unknown>,
    sessionId: string,
    turnId: string,
    occurredAt: number,
    transcriptSourcePath: string | null
) {
    const explicitCapture = transcriptSourcePath
        ? (agent === 'codex'
            ? deps.readCodexArchiveCapture(transcriptSourcePath, {
                sessionId,
                occurredAt,
                sessionTitle: typeof normalizedRaw.sessionTitle === 'string' ? normalizedRaw.sessionTitle : null,
                cwd: typeof normalizedRaw.cwd === 'string' ? normalizedRaw.cwd : null
            })
            : deps.readTranscriptCapture(transcriptSourcePath))
        : null;

    if (explicitCapture) return explicitCapture;

    if (agent === 'codex') {
        return deps.readCodexCapture(normalizedRaw, { sessionId, turnId, occurredAt });
    }

    return deps.readInlineHookCapture(agent, normalizedRaw, { sessionId, turnId, occurredAt });
}

function printResult(
    asJson: boolean,
    quiet: boolean,
    payload: {
        nodeId: string | null;
        nodeIds: string[];
        keys: string[];
        sessionNodeId: string | null;
        contextId: string;
        sessionId: string;
        insertedCount: number;
        dedupedCount: number;
        transcriptMessageCount: number;
        branch: string | null;
        commitSha: string | null;
        dumpPath: string | null;
        hookEventLogPath: string | null;
        transcriptDumpPath: string | null;
        transcriptHistoryPath: string | null;
        agent: HookSupportedAgent;
    }
): number {
    if (asJson) {
        console.log(JSON.stringify({ ok: true, ...payload }, null, 2));
        return 0;
    }

    if (!quiet) {
        console.log(`hook_ingest: captured ${payload.insertedCount > 0 ? payload.insertedCount : payload.dedupedCount} ${payload.agent} message${(payload.insertedCount + payload.dedupedCount) === 1 ? '' : 's'}`);
        if (payload.nodeId) console.log(`node_id: ${payload.nodeId}`);
        console.log(`context_id: ${payload.contextId}`);
        console.log(`session_id: ${payload.sessionId}`);
        console.log(`inserted: ${payload.insertedCount}`);
        console.log(`deduped: ${payload.dedupedCount}`);
        if (payload.dumpPath) console.log(`hook_dump: ${payload.dumpPath}`);
        if (payload.hookEventLogPath) console.log(`hook_event_log: ${payload.hookEventLogPath}`);
        if (payload.transcriptDumpPath) console.log(`transcript_dump: ${payload.transcriptDumpPath}`);
        if (payload.transcriptHistoryPath) console.log(`transcript_history: ${payload.transcriptHistoryPath}`);
        if (payload.branch) console.log(`branch: ${payload.branch}`);
        if (payload.commitSha) console.log(`commit: ${payload.commitSha}`);
    }
    return 0;
}

export function createHookIngestCommand(deps: HookCommandDeps) {
    return async function commandHookIngest(agent: HookSupportedAgent, flags: FlagMap): Promise<number> {
        const asJson = Boolean(flags.json);
        const quiet = Boolean(flags.quiet) || asJson;
        const payloadText = parsePayloadText(deps, flags);
        if (!payloadText || payloadText.trim().length === 0) {
            console.error('connector_hook_ingest_requires_payload: provide --input-file, --payload, or stdin');
            return 1;
        }

        const parsedPayload = parsePayload(payloadText);
        const normalized = deps.normalizeHookPayload(agent, parsedPayload);
        const explicitTranscriptPath = deps.resolveHookTranscriptPath(normalized.raw);
        const codexArchivePath = agent === 'codex' && !explicitTranscriptPath
            ? deps.resolveCodexSessionArchivePath(normalized.raw, normalized.sessionId)
            : null;
        const codexArchiveCapture = agent === 'codex' && codexArchivePath
            ? deps.readCodexArchiveCapture(codexArchivePath, {
                sessionId: normalized.sessionId,
                occurredAt: normalized.occurredAt,
                sessionTitle: typeof normalized.raw.sessionTitle === 'string' ? normalized.raw.sessionTitle : null,
                cwd: typeof normalized.raw.cwd === 'string' ? normalized.raw.cwd : null
            })
            : null;

        if (agent === 'codex') {
            if (codexArchiveCapture?.cwd && typeof normalized.raw.cwd !== 'string') normalized.raw.cwd = codexArchiveCapture.cwd;
            if (codexArchiveCapture?.sessionTitle && typeof normalized.raw.sessionTitle !== 'string') normalized.raw.sessionTitle = codexArchiveCapture.sessionTitle;
        }

        const requestedRepoRoot = deps.parseOptionalStringFlag(flags['repo-root']);
        const repoRoot = deps.resolveHookCaptureRoot(
            agent,
            normalized.raw,
            requestedRepoRoot ? deps.resolveRepoRoot(requestedRepoRoot) : null
        ) ?? deps.resolveRepoRoot(requestedRepoRoot);
        const explicitContextId = deps.parseOptionalStringFlag(flags['context-id'] ?? flags.contextId);
        const contextId = await deps.resolveContextIdForHookIngest(repoRoot, explicitContextId);
        if (!contextId) {
            console.error('connector_hook_ingest_context_missing: no workspace matched this repository path. Run `0ctx enable` in this repo first, or use --context-id only for support workflows.');
            return 1;
        }

        const captureNow = Date.now();
        const transcriptSourcePath = explicitTranscriptPath ?? codexArchivePath;
        const transcriptDumpPath = deps.persistHookTranscriptSnapshot({ agent, sessionId: normalized.sessionId, transcriptPath: transcriptSourcePath });
        const transcriptHistoryPath = deps.persistHookTranscriptHistory({ agent, sessionId: normalized.sessionId, transcriptPath: transcriptSourcePath, now: captureNow });
        const hookEventLogPath = deps.appendHookEventLog({ agent, sessionId: normalized.sessionId, rawText: payloadText });
        const dumpPath = deps.persistHookDump({
            agent,
            contextId,
            rawText: payloadText,
            parsedPayload,
            normalized,
            repositoryRoot: deps.resolveHookCaptureRoot(agent, normalized.raw, repoRoot),
            eventLogPath: hookEventLogPath,
            transcriptSnapshotPath: transcriptDumpPath,
            transcriptHistoryPath,
            now: captureNow
        });
        const artifacts: HookArtifactPaths = { dumpPath, hookEventLogPath, transcriptDumpPath, transcriptHistoryPath, transcriptSourcePath };

        const workspaceCheck = await deps.validateHookIngestWorkspace({ agent, contextId, repoRoot, payload: normalized.raw });
        if (!workspaceCheck.ok) {
            console.error(workspaceCheck.error ?? 'connector_hook_ingest_workspace_mismatch');
            return 1;
        }

        const captureRoot = workspaceCheck.captureRoot;
        const branch = deps.safeGitValue(captureRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
        const commitSha = deps.safeGitValue(captureRoot, ['rev-parse', 'HEAD']);
        const captureData = resolveTranscriptCapture(
            deps,
            agent,
            normalized.raw,
            normalized.sessionId,
            normalized.turnId,
            normalized.occurredAt,
            transcriptSourcePath
        );
        const sessionNode = await deps.ensureChatSessionNode({
            contextId,
            agent,
            sessionId: normalized.sessionId,
            summary: captureData?.summary ?? normalized.summary,
            startedAt: captureData?.startedAt ?? normalized.occurredAt,
            branch,
            commitSha,
            repositoryRoot: captureRoot,
            artifacts,
            sessionTitle: captureData?.sessionTitle ?? (typeof normalized.raw.sessionTitle === 'string' ? normalized.raw.sessionTitle : null)
        });
        const commitNode = await deps.ensureChatCommitNode({ contextId, agent, branch, commitSha, repositoryRoot: captureRoot });
        const capturedNodes: Array<{ id: string; key: string; role: string; occurredAt: number; deduped: boolean }> = [];
        const messages = captureData?.messages ?? [];

        const upsertCapturedNode = async (
            key: string,
            role: string,
            occurredAt: number,
            content: string,
            rawPayload: Record<string, unknown>
        ) => {
            const existing = await deps.sendToDaemon('getByKey', { contextId, key, includeHidden: true }) as { id?: string } | null;
            if (existing?.id) {
                capturedNodes.push({ id: existing.id, key, role, occurredAt, deduped: true });
                return;
            }

            const node = await deps.sendToDaemon('addNode', {
                contextId,
                type: 'artifact',
                hidden: true,
                thread: normalized.sessionId,
                key,
                tags: ['chat_turn', `agent:${agent}`, `role:${role}`],
                source: `hook:${agent}`,
                content,
                createdAtOverride: occurredAt,
                rawPayload
            }) as { id: string };

            capturedNodes.push({ id: node.id, key, role, occurredAt, deduped: false });
            if (sessionNode?.id) await deps.sendToDaemon('addEdge', { fromId: node.id, toId: sessionNode.id, relation: 'depends_on' });
            if (commitNode?.id) await deps.sendToDaemon('addEdge', { fromId: node.id, toId: commitNode.id, relation: 'depends_on' });
        };

        if (messages.length > 0) {
            for (const message of messages) {
                await upsertCapturedNode(
                    `chat_turn:${agent}:${normalized.sessionId}:${message.messageId}`,
                    message.role,
                    message.occurredAt,
                    message.text,
                    {
                        ...message.raw,
                        role: message.role,
                        text: message.text,
                        branch,
                        commitSha,
                        occurredAt: message.occurredAt,
                        meta: deps.buildHookCaptureMeta({
                            agent,
                            sessionId: normalized.sessionId,
                            turnId: message.messageId,
                            role: message.role,
                            occurredAt: message.occurredAt,
                            branch,
                            commitSha,
                            repositoryRoot: captureRoot,
                            artifacts,
                            extra: {
                                parentId: message.parentId,
                                lineNumber: message.lineNumber,
                                transcriptMessageId: message.messageId,
                                captureSource: transcriptSourcePath ? (agent === 'codex' ? 'codex-archive' : 'transcript') : (agent === 'codex' ? 'codex-notify' : 'inline-hook')
                            }
                        })
                    }
                );
            }
        } else {
            await upsertCapturedNode(
                `chat_turn:${agent}:${normalized.sessionId}:${normalized.turnId}`,
                normalized.role,
                normalized.occurredAt,
                normalized.summary,
                {
                    ...normalized.raw,
                    branch,
                    commitSha,
                    occurredAt: normalized.occurredAt,
                    meta: deps.buildHookCaptureMeta({
                        agent,
                        sessionId: normalized.sessionId,
                        turnId: normalized.turnId,
                        role: normalized.role,
                        occurredAt: normalized.occurredAt,
                        branch,
                        commitSha,
                        repositoryRoot: captureRoot,
                        artifacts
                    })
                }
            );
        }

        const insertedNodes = capturedNodes.filter(node => !node.deduped);
        const dedupedNodes = capturedNodes.filter(node => node.deduped);
        const leadNode = insertedNodes.at(-1) ?? capturedNodes.at(-1) ?? null;
        return printResult(asJson, quiet, {
            nodeId: leadNode?.id ?? null,
            nodeIds: capturedNodes.map(node => node.id),
            keys: capturedNodes.map(node => node.key),
            sessionNodeId: sessionNode?.id ?? null,
            contextId,
            sessionId: normalized.sessionId,
            insertedCount: insertedNodes.length,
            dedupedCount: dedupedNodes.length,
            transcriptMessageCount: messages.length,
            branch,
            commitSha,
            dumpPath,
            hookEventLogPath,
            transcriptDumpPath,
            transcriptHistoryPath,
            agent
        });
    };
}
