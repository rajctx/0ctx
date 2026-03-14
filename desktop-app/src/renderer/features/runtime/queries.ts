import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DESKTOP_MUTATION_TYPES } from '../../../shared/contracts/events';
import type {
  ChatMessage,
  ChatSessionDetail,
  ChatSessionSummary,
  CheckpointDetail,
  CheckpointSummary,
  DataPolicy,
  DesktopPosture,
  DesktopPreferences,
  HookHealth,
  InsightSummary,
  RepoReadiness,
  WorkspaceComparison,
  WorkstreamComparison,
  WorkstreamSummary
} from '../../../shared/types/domain';
import { desktopBridge } from '../../lib/bridge';

export const desktopQueryKeys = {
  status: ['desktop', 'status'] as const,
  posture: ['desktop', 'posture'] as const,
  version: ['desktop', 'version'] as const,
  preferences: ['desktop', 'preferences'] as const,
  connector: ['desktop', 'connector'] as const,
  workstreams: (contextId: string | null) => ['desktop', 'workstreams', contextId] as const,
  sessions: (contextId: string | null, workstreamId: string | null) => ['desktop', 'sessions', contextId, workstreamId] as const,
  sessionDetail: (contextId: string | null, sessionId: string | null) => ['desktop', 'session-detail', contextId, sessionId] as const,
  sessionMessages: (contextId: string | null, sessionId: string | null) => ['desktop', 'session-messages', contextId, sessionId] as const,
  checkpoints: (contextId: string | null, workstreamId: string | null) => ['desktop', 'checkpoints', contextId, workstreamId] as const,
  checkpointDetail: (checkpointId: string | null) => ['desktop', 'checkpoint-detail', checkpointId] as const,
  insights: (contextId: string | null, workstreamId: string | null) => ['desktop', 'insights', contextId, workstreamId] as const,
  dataPolicy: (contextId: string | null) => ['desktop', 'data-policy', contextId] as const,
  repoReadiness: (contextId: string | null, repoRoot: string | null) => ['desktop', 'repo-readiness', contextId, repoRoot] as const,
  workspaceComparison: (sourceContextId: string | null, targetContextId: string | null) => ['desktop', 'workspace-comparison', sourceContextId, targetContextId] as const,
  workstreamComparison: (
    contextId: string | null,
    sourceKey: string | null,
    targetKey: string | null
  ) => ['desktop', 'workstream-comparison', contextId, sourceKey, targetKey] as const,
  hookHealth: ['desktop', 'hook-health'] as const,
  handoff: (contextId: string | null, branch: string | null, worktreePath: string | null) => ['desktop', 'handoff', contextId, branch, worktreePath] as const
};

export function useDesktopStatus() {
  return useQuery({
    queryKey: desktopQueryKeys.status,
    queryFn: () => desktopBridge.app.getStatus()
  });
}

export function useDesktopPosture() {
  return useQuery({
    queryKey: desktopQueryKeys.posture,
    queryFn: () => desktopBridge.app.getPosture() as Promise<DesktopPosture>
  });
}

export function useDesktopVersion() {
  return useQuery({
    queryKey: desktopQueryKeys.version,
    queryFn: () => desktopBridge.app.getVersion()
  });
}

export function usePreferences() {
  return useQuery({
    queryKey: desktopQueryKeys.preferences,
    queryFn: () => desktopBridge.preferences.get()
  });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<DesktopPreferences>) => desktopBridge.preferences.update(patch),
    onSuccess: (data) => {
      queryClient.setQueryData(desktopQueryKeys.preferences, data);
    }
  });
}

export function useConnectorStatus() {
  return useQuery({
    queryKey: desktopQueryKeys.connector,
    queryFn: () => desktopBridge.connector.getStatus()
  });
}

export function useWorkstreams(contextId: string | null) {
  return useQuery({
    queryKey: desktopQueryKeys.workstreams(contextId),
    enabled: Boolean(contextId),
    queryFn: () => desktopBridge.daemon.call<WorkstreamSummary[]>('listBranchLanes', {
      contextId,
      limit: 250
    })
  });
}

export function useSessions(contextId: string | null, branch: string | null, worktreePath: string | null, key: string | null) {
  return useQuery({
    queryKey: desktopQueryKeys.sessions(contextId, key),
    enabled: Boolean(contextId),
    queryFn: () => {
      if (branch) {
        return desktopBridge.daemon.call<ChatSessionSummary[]>('listBranchSessions', {
          contextId,
          branch,
          worktreePath,
          limit: 250
        });
      }

      return desktopBridge.daemon.call<ChatSessionSummary[]>('listChatSessions', {
        contextId,
        limit: 250
      });
    }
  });
}

export function useSessionDetail(contextId: string | null, sessionId: string | null) {
  return useQuery({
    queryKey: desktopQueryKeys.sessionDetail(contextId, sessionId),
    enabled: Boolean(contextId && sessionId),
    queryFn: () => desktopBridge.daemon.call<ChatSessionDetail>('getSessionDetail', {
      contextId,
      sessionId
    })
  });
}

export function useSessionMessages(contextId: string | null, sessionId: string | null) {
  return useQuery({
    queryKey: desktopQueryKeys.sessionMessages(contextId, sessionId),
    enabled: Boolean(contextId && sessionId),
    queryFn: () => desktopBridge.daemon.call<ChatMessage[]>('listSessionMessages', {
      contextId,
      sessionId,
      limit: 500
    })
  });
}

export function useCheckpoints(contextId: string | null, branch: string | null, worktreePath: string | null, key: string | null) {
  return useQuery({
    queryKey: desktopQueryKeys.checkpoints(contextId, key),
    enabled: Boolean(contextId),
    queryFn: () => {
      if (branch) {
        return desktopBridge.daemon.call<CheckpointSummary[]>('listBranchCheckpoints', {
          contextId,
          branch,
          worktreePath,
          limit: 250
        });
      }

      return desktopBridge.daemon.call<CheckpointSummary[]>('listCheckpoints', {
        contextId
      });
    }
  });
}

export function useCheckpointDetail(checkpointId: string | null) {
  return useQuery({
    queryKey: desktopQueryKeys.checkpointDetail(checkpointId),
    enabled: Boolean(checkpointId),
    queryFn: () => desktopBridge.daemon.call<CheckpointDetail>('getCheckpointDetail', {
      checkpointId
    })
  });
}

export function useInsights(contextId: string | null, branch: string | null, worktreePath: string | null, key: string | null) {
  return useQuery({
    queryKey: desktopQueryKeys.insights(contextId, key),
    enabled: Boolean(contextId),
    queryFn: () => desktopBridge.daemon.call<InsightSummary[]>('listWorkstreamInsights', {
      contextId,
      branch,
      worktreePath,
      limit: 250
    })
  });
}

export function useDataPolicy(contextId: string | null) {
  return useQuery({
    queryKey: desktopQueryKeys.dataPolicy(contextId),
    enabled: Boolean(contextId),
    queryFn: () => desktopBridge.daemon.call<DataPolicy>('getDataPolicy', {
      contextId
    })
  });
}

export function useRepoReadiness(contextId: string | null, repoRoot: string | null) {
  return useQuery({
    queryKey: desktopQueryKeys.repoReadiness(contextId, repoRoot),
    enabled: Boolean(contextId || repoRoot),
    queryFn: () => desktopBridge.daemon.call<RepoReadiness>('getRepoReadiness', {
      ...(contextId ? { contextId } : {}),
      ...(repoRoot ? { repoRoot } : {})
    })
  });
}

export function useWorkspaceComparison(sourceContextId: string | null, targetContextId: string | null) {
  return useQuery({
    queryKey: desktopQueryKeys.workspaceComparison(sourceContextId, targetContextId),
    enabled: Boolean(sourceContextId && targetContextId),
    queryFn: () => desktopBridge.daemon.call<WorkspaceComparison>('compareWorkspaces', {
      sourceContextId,
      targetContextId
    })
  });
}

export function useWorkstreamComparison(
  contextId: string | null,
  sourceBranch: string | null,
  sourceWorktreePath: string | null,
  targetBranch: string | null,
  targetWorktreePath: string | null
) {
  return useQuery({
    queryKey: desktopQueryKeys.workstreamComparison(
      contextId,
      sourceBranch ? `${sourceBranch}::${String(sourceWorktreePath || '')}` : null,
      targetBranch ? `${targetBranch}::${String(targetWorktreePath || '')}` : null
    ),
    enabled: Boolean(contextId && sourceBranch && targetBranch),
    queryFn: () => desktopBridge.daemon.call<WorkstreamComparison>('compareWorkstreams', {
      contextId,
      sourceBranch,
      sourceWorktreePath,
      targetBranch,
      targetWorktreePath
    })
  });
}

export function useHookHealth() {
  return useQuery({
    queryKey: desktopQueryKeys.hookHealth,
    queryFn: async () => {
      const response = await desktopBridge.daemon.call<HookHealth>('getHookHealth', {});
      return {
        ...response,
        readyCount: response.readyCount ?? (response.agents ?? []).filter((agent) => agent.installed).length
      };
    }
  });
}

export function useHandoff(contextId: string | null, branch: string | null, worktreePath: string | null) {
  return useQuery({
    queryKey: desktopQueryKeys.handoff(contextId, branch, worktreePath),
    enabled: Boolean(contextId && branch),
    queryFn: () => desktopBridge.daemon.call<Array<Record<string, unknown>>>('getHandoffTimeline', {
      contextId,
      branch,
      worktreePath,
      limit: 80
    })
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name: string; path: string }) => {
      const created = await desktopBridge.daemon.call<{ id?: string; contextId?: string }>('createContext', {
        name: payload.name,
        paths: [payload.path]
      });
      const contextId = created.contextId ?? created.id ?? null;
      if (contextId) {
        await desktopBridge.daemon.call('switchContext', { contextId });
      }
      return contextId;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.status });
    }
  });
}

export function useRestartConnector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => desktopBridge.connector.restart(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.connector });
    }
  });
}

export function useCheckForUpdates() {
  return useMutation({
    mutationFn: () => desktopBridge.updates.check()
  });
}

export function useOpenPath() {
  return useMutation({
    mutationFn: (targetPath: string) => desktopBridge.shell.openPath(targetPath)
  });
}

export function useDesktopEventBridge(activeContextId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribe = desktopBridge.events.subscribe((event) => {
      if (event.kind === 'posture') {
        void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.status });
        return;
      }

      const type = String(event.payload?.type || '');
      const method = String(event.payload?.method || '');
      if (DESKTOP_MUTATION_TYPES.has(type) || method) {
        void queryClient.invalidateQueries();
      }
    });

    void desktopBridge.events.start(activeContextId).catch(() => undefined);

    return () => {
      unsubscribe();
      void desktopBridge.events.stop().catch(() => undefined);
    };
  }, [activeContextId, queryClient]);
}
