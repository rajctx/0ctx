import type { HookCommandDeps, FlagMap, HookSessionStartResult } from './types';
import type { HookSupportedAgent } from '../../../cli-core/types';

export function createHookSessionStartCommand(deps: HookCommandDeps) {
    return async function commandHookSessionStart(
        agent: HookSupportedAgent,
        flags: FlagMap,
        rawPayload: Record<string, unknown>
    ): Promise<number> {
        const asJson = Boolean(flags.json);
        if (agent !== 'claude' && agent !== 'factory' && agent !== 'antigravity') {
            if (asJson) {
                const payload: HookSessionStartResult = { ok: true, injected: false, reason: 'unsupported_agent' };
                console.log(JSON.stringify(payload, null, 2));
            }
            return 0;
        }

        const requestedRepoRoot = deps.parseOptionalStringFlag(flags['repo-root']);
        const repoRoot = deps.resolveHookCaptureRoot(
            agent,
            rawPayload,
            requestedRepoRoot ? deps.resolveRepoRoot(requestedRepoRoot) : null
        ) ?? deps.resolveRepoRoot(requestedRepoRoot);
        const explicitContextId = deps.parseOptionalStringFlag(flags['context-id'] ?? flags.contextId);
        const contextId = await deps.resolveContextIdForHookIngest(repoRoot, explicitContextId);
        if (!contextId) {
            if (asJson) {
                const payload: HookSessionStartResult = { ok: true, injected: false, reason: 'context_missing' };
                console.log(JSON.stringify(payload, null, 2));
            }
            return 0;
        }

        const workspaceCheck = await deps.validateHookIngestWorkspace({ agent, contextId, repoRoot, payload: rawPayload });
        if (!workspaceCheck.ok) {
            if (asJson) {
                const payload: HookSessionStartResult = {
                    ok: true,
                    injected: false,
                    reason: 'workspace_mismatch',
                    captureRoot: workspaceCheck.captureRoot
                };
                console.log(JSON.stringify(payload, null, 2));
            }
            return 0;
        }

        const captureRoot = workspaceCheck.captureRoot;
        const branch = deps.safeGitValue(captureRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
        const pack = await deps.sendToDaemon('getAgentContextPack', {
            contextId,
            branch,
            worktreePath: captureRoot,
            sessionLimit: 3,
            checkpointLimit: 2,
            handoffLimit: 5
        }) as { workspaceName?: string; promptText?: string };

        if (asJson) {
            const payload: HookSessionStartResult = {
                ok: true,
                injected: true,
                contextId,
                workspaceName: pack.workspaceName,
                captureRoot,
                branch,
                context: pack.promptText
            };
            console.log(JSON.stringify(payload, null, 2));
        } else if (typeof pack.promptText === 'string' && pack.promptText.trim().length > 0) {
            process.stdout.write(pack.promptText);
        }

        return 0;
    };
}
