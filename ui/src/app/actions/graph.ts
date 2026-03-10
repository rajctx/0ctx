'use server';

import { bffPost } from '@/lib/bff-client';
import type { ContextItem, GraphNode, GraphPayload, ChatSessionSummary, ChatTurnSummary, NodePayloadRecord } from '@/lib/graph';
import type { HookHealthSnapshot } from '@/app/actions/types';

export async function getContexts(machineId?: string | null): Promise<ContextItem[] | null> {
  const res = await bffPost<ContextItem[]>('/api/v1/runtime/command', { method: 'listContexts', machineId: machineId ?? undefined });
  return res.ok && Array.isArray(res.data) ? res.data : null;
}

export async function getGraphData(contextId: string, machineId?: string | null, options: { includeHidden?: boolean } = {}): Promise<GraphPayload> {
  try {
    const res = await bffPost<GraphPayload>('/api/v1/runtime/command', { method: 'getGraphData', contextId, includeHidden: options.includeHidden ?? false, machineId: machineId ?? undefined });
    if (res.ok && res.data) return res.data;
  } catch { }
  return { nodes: [], edges: [] };
}

export async function listChatSessionsAction(contextId: string, machineId?: string | null): Promise<ChatSessionSummary[]> {
  if (!contextId) return [];
  const res = await bffPost<ChatSessionSummary[]>('/api/v1/runtime/command', { method: 'listChatSessions', contextId, machineId: machineId ?? undefined });
  return Array.isArray(res.data) ? res.data : [];
}

export async function listChatTurnsAction(contextId: string, sessionId: string, machineId?: string | null): Promise<ChatTurnSummary[]> {
  if (!contextId || !sessionId) return [];
  const res = await bffPost<ChatTurnSummary[]>('/api/v1/runtime/command', { method: 'listChatTurns', contextId, sessionId, machineId: machineId ?? undefined });
  return Array.isArray(res.data) ? res.data : [];
}

export async function getNodePayloadAction(nodeId: string, machineId?: string | null): Promise<NodePayloadRecord | null> {
  if (!nodeId) return null;
  const res = await bffPost<NodePayloadRecord>('/api/v1/runtime/command', { method: 'getNodePayload', nodeId, machineId: machineId ?? undefined });
  return res.data ?? null;
}

export async function getHookHealthAction(machineId?: string | null): Promise<HookHealthSnapshot | null> {
  const res = await bffPost<HookHealthSnapshot>('/api/v1/runtime/command', { method: 'getHookHealth', machineId: machineId ?? undefined });
  if (!res.ok || !res.data) return null;
  return {
    statePath: String(res.data.statePath ?? ''),
    projectRoot: typeof res.data.projectRoot === 'string' ? res.data.projectRoot : null,
    projectConfigPath: typeof res.data.projectConfigPath === 'string' ? res.data.projectConfigPath : null,
    updatedAt: typeof res.data.updatedAt === 'number' ? res.data.updatedAt : null,
    agents: Array.isArray(res.data.agents)
      ? res.data.agents.map((agent) => ({
          agent: String(agent.agent ?? 'unknown'),
          status: agent.status === 'Supported' || agent.status === 'Planned' || agent.status === 'Skipped' ? agent.status : 'Skipped',
          installed: Boolean(agent.installed),
          command: typeof agent.command === 'string' ? agent.command : null,
          updatedAt: typeof agent.updatedAt === 'number' ? agent.updatedAt : null,
          notes: typeof agent.notes === 'string' ? agent.notes : null,
        }))
      : [],
  };
}

export async function updateNodeData(id: string, updates: { content?: string; tags?: string[] }, machineId?: string | null): Promise<unknown> {
  return (await bffPost('/api/v1/runtime/command', { method: 'updateNode', id, updates, machineId: machineId ?? undefined })).data;
}

export async function createContext(name: string, paths: string[] = [], machineId?: string | null): Promise<unknown> {
  return (await bffPost('/api/v1/runtime/command', { method: 'createContext', name, paths, machineId: machineId ?? undefined })).data;
}

export async function deleteContextAction(id: string, machineId?: string | null): Promise<unknown> {
  return (await bffPost('/api/v1/runtime/command', { method: 'deleteContext', id, machineId: machineId ?? undefined })).data;
}

export async function deleteNodeAction(contextId: string, id: string, machineId?: string | null): Promise<unknown> {
  return (await bffPost('/api/v1/runtime/command', { method: 'deleteNode', contextId, id, machineId: machineId ?? undefined })).data;
}

export async function addNodeAction(contextId: string, data: { type: string; content: string; tags?: string[]; key?: string }, machineId?: string | null): Promise<GraphNode | null> {
  const res = await bffPost<GraphNode>('/api/v1/runtime/command', {
    method: 'addNode',
    contextId,
    type: data.type,
    content: data.content,
    tags: data.tags ?? [],
    key: data.key || undefined,
    source: 'dashboard',
    machineId: machineId ?? undefined,
  });
  return res.data ?? null;
}
