import { Graph, openDb } from '@0ctx/core';

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
    session?: unknown;
    messages?: unknown;
    checkpointCount?: unknown;
    latestCheckpoint?: unknown;
  };

  return (
    !detail.session
    && Array.isArray(detail.messages)
    && detail.messages.length === 0
    && Number(detail.checkpointCount ?? 0) === 0
    && !detail.latestCheckpoint
  );
}

export class LocalGraphService {
  private graph: Graph | null = null;
  private db: ReturnType<typeof openDb> | null = null;

  resolveReadFallback(method: string, params: Record<string, unknown>, currentResult?: unknown) {
    const contextId = readString(params, 'contextId');

    try {
      switch (method) {
        case 'listContexts':
          return Array.isArray(currentResult) && currentResult.length > 0
            ? currentResult
            : this.getGraph().listContexts();
        case 'listChatSessions':
          if (!contextId || (Array.isArray(currentResult) && currentResult.length > 0)) {
            return currentResult;
          }
          return this.getGraph().listChatSessions(contextId, readLimit(params, 250));
        case 'listBranchLanes':
          if (!contextId || (Array.isArray(currentResult) && currentResult.length > 0)) {
            return currentResult;
          }
          return this.getGraph().listBranchLanes(contextId, readLimit(params, 250));
        case 'listBranchSessions': {
          const branch = readString(params, 'branch');
          if (!contextId || !branch || (Array.isArray(currentResult) && currentResult.length > 0)) {
            return currentResult;
          }
          return this.getGraph().listBranchSessions(contextId, branch, {
            worktreePath: readString(params, 'worktreePath'),
            limit: readLimit(params, 250)
          });
        }
        case 'listSessionMessages': {
          const sessionId = readString(params, 'sessionId');
          if (!contextId || !sessionId || (Array.isArray(currentResult) && currentResult.length > 0)) {
            return currentResult;
          }
          return this.getGraph().listSessionMessages(contextId, sessionId, readLimit(params, 500));
        }
        case 'getSessionDetail': {
          const sessionId = readString(params, 'sessionId');
          if (!contextId || !sessionId || !isEmptySessionDetail(currentResult)) {
            return currentResult;
          }
          return this.getGraph().getSessionDetail(contextId, sessionId);
        }
        case 'listBranchCheckpoints': {
          const branch = readString(params, 'branch');
          if (!contextId || !branch || (Array.isArray(currentResult) && currentResult.length > 0)) {
            return currentResult;
          }
          return this.getGraph().listBranchCheckpoints(contextId, branch, {
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
    if (!this.db) {
      return;
    }
    this.db.close();
    this.db = null;
    this.graph = null;
  }

  private getGraph() {
    if (this.graph) {
      return this.graph;
    }

    this.db = openDb();
    this.graph = new Graph(this.db);
    return this.graph;
  }
}
