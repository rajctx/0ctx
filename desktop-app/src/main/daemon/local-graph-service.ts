import type { Graph as CoreGraph, openDb as openCoreDb } from '@0ctx/core';

type CoreModule = {
  Graph: typeof CoreGraph;
  openDb: typeof openCoreDb;
};
type CoreDb = ReturnType<CoreModule['openDb']>;

function readString(params: Record<string, unknown>, key: string) {
  const value = params[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readLimit(params: Record<string, unknown>, fallback: number) {
  const value = params.limit;
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function isEmptySessionDetail(value: unknown) {
  if (!value || typeof value !== 'object') {
    return true;
  }

  const detail = value as {
    session?: {
      turnCount?: unknown;
      messageCount?: unknown;
    } | null;
    messages?: unknown;
    checkpointCount?: unknown;
    latestCheckpoint?: unknown;
  };
  const sessionTurnCount = Number(detail.session?.turnCount ?? detail.session?.messageCount ?? 0);
  const hasMissingMessages = Array.isArray(detail.messages) && detail.messages.length === 0 && sessionTurnCount > 0;

  return (
    hasMissingMessages
    || (
      !detail.session
      && Array.isArray(detail.messages)
      && detail.messages.length === 0
      && Number(detail.checkpointCount ?? 0) === 0
      && !detail.latestCheckpoint
    )
  );
}

export class LocalGraphService {
  private graph: CoreGraph | null = null;
  private db: CoreDb | null = null;
  private coreModule: CoreModule | null | undefined = undefined;
  private disabled = false;

  resolvePreferredRead(method: string, params: Record<string, unknown>) {
    const contextId = readString(params, 'contextId');
    const graph = this.getGraph();

    if (!graph) {
      return undefined;
    }

    try {
      switch (method) {
        case 'listChatSessions':
          return contextId ? graph.listChatSessions(contextId, readLimit(params, 250)) : undefined;
        case 'listBranchLanes':
          return contextId ? graph.listBranchLanes(contextId, readLimit(params, 250)) : undefined;
        case 'listBranchSessions': {
          const branch = readString(params, 'branch');
          if (!contextId || !branch) {
            return undefined;
          }
          return graph.listBranchSessions(contextId, branch, {
            worktreePath: readString(params, 'worktreePath'),
            limit: readLimit(params, 250)
          });
        }
        case 'listSessionMessages': {
          const sessionId = readString(params, 'sessionId');
          return contextId && sessionId
            ? graph.listSessionMessages(contextId, sessionId, readLimit(params, 500))
            : undefined;
        }
        case 'getSessionDetail': {
          const sessionId = readString(params, 'sessionId');
          return contextId && sessionId
            ? graph.getSessionDetail(contextId, sessionId)
            : undefined;
        }
        case 'listBranchCheckpoints': {
          const branch = readString(params, 'branch');
          if (!contextId || !branch) {
            return undefined;
          }
          return graph.listBranchCheckpoints(contextId, branch, {
            worktreePath: readString(params, 'worktreePath'),
            limit: readLimit(params, 250)
          });
        }
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }

  resolveReadFallback(method: string, params: Record<string, unknown>, currentResult?: unknown) {
    const contextId = readString(params, 'contextId');
    const graph = this.getGraph();

    if (!graph) {
      return currentResult;
    }

    try {
      switch (method) {
        case 'listContexts':
          return Array.isArray(currentResult) && currentResult.length > 0
            ? currentResult
            : graph.listContexts();
        case 'listChatSessions':
          if (!contextId || (Array.isArray(currentResult) && currentResult.length > 0)) {
            return currentResult;
          }
          return graph.listChatSessions(contextId, readLimit(params, 250));
        case 'listBranchLanes':
          if (!contextId || (Array.isArray(currentResult) && currentResult.length > 0)) {
            return currentResult;
          }
          return graph.listBranchLanes(contextId, readLimit(params, 250));
        case 'listBranchSessions': {
          const branch = readString(params, 'branch');
          if (!contextId || !branch || (Array.isArray(currentResult) && currentResult.length > 0)) {
            return currentResult;
          }
          return graph.listBranchSessions(contextId, branch, {
            worktreePath: readString(params, 'worktreePath'),
            limit: readLimit(params, 250)
          });
        }
        case 'listSessionMessages': {
          const sessionId = readString(params, 'sessionId');
          if (!contextId || !sessionId || (Array.isArray(currentResult) && currentResult.length > 0)) {
            return currentResult;
          }
          return graph.listSessionMessages(contextId, sessionId, readLimit(params, 500));
        }
        case 'getSessionDetail': {
          const sessionId = readString(params, 'sessionId');
          if (!contextId || !sessionId || !isEmptySessionDetail(currentResult)) {
            return currentResult;
          }
          return graph.getSessionDetail(contextId, sessionId);
        }
        case 'listBranchCheckpoints': {
          const branch = readString(params, 'branch');
          if (!contextId || !branch || (Array.isArray(currentResult) && currentResult.length > 0)) {
            return currentResult;
          }
          return graph.listBranchCheckpoints(contextId, branch, {
            worktreePath: readString(params, 'worktreePath'),
            limit: readLimit(params, 250)
          });
        }
        default:
          return currentResult;
      }
    } catch {
      return currentResult;
    }
  }

  dispose() {
    this.resetGraph();
  }

  protected loadCoreModule(): CoreModule | null {
    if (this.coreModule !== undefined) {
      return this.coreModule;
    }

    try {
      this.coreModule = require('@0ctx/core') as CoreModule;
    } catch {
      this.coreModule = null;
    }

    return this.coreModule;
  }

  private getGraph() {
    if (this.disabled) {
      return null;
    }

    if (this.graph) {
      return this.graph;
    }

    const core = this.loadCoreModule();
    if (!core) {
      return null;
    }

    try {
      this.db = core.openDb();
      this.graph = new core.Graph(this.db);
      return this.graph;
    } catch {
      this.disabled = true;
      this.resetGraph();
      return null;
    }
  }

  private resetGraph() {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Ignore cleanup errors after a failed local-graph init.
      }
    }

    this.db = null;
    this.graph = null;
  }
}
