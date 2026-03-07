export const NODE_TYPES = [
  'background',
  'decision',
  'constraint',
  'goal',
  'assumption',
  'open_question',
  'artifact'
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export interface ContextItem {
  id: string;
  name: string;
  createdAt: number;
}

export interface GraphNode {
  id: string;
  contextId?: string;
  thread?: string;
  type: NodeType | string;
  content: string;
  key?: string | null;
  createdAt: number;
  tags?: string[];
  source?: string | null;
  hidden?: boolean;
}

export interface GraphEdge {
  id: string;
  fromId: string;
  toId: string;
  relation: string;
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ChatSessionSummary {
  sessionId: string;
  sessionNodeId: string | null;
  summary: string;
  startedAt: number;
  lastTurnAt: number;
  turnCount: number;
  branch: string | null;
  commitSha: string | null;
}

export interface ChatTurnSummary {
  nodeId: string;
  contextId: string;
  sessionId: string;
  key: string | null;
  type: NodeType | string;
  content: string;
  tags: string[];
  source: string | null;
  hidden: boolean;
  createdAt: number;
  role: string | null;
  branch: string | null;
  commitSha: string | null;
  hasPayload: boolean;
  payloadBytes: number | null;
}

export interface NodePayloadRecord {
  nodeId: string;
  contextId: string;
  contentType: string;
  compression: 'gzip' | 'none';
  byteLength: number;
  payload: unknown;
  createdAt: number;
  updatedAt: number;
}

export const NODE_TYPE_META: Record<
  NodeType,
  { label: string; color: string; surface: string; border: string }
> = {
  background: {
    label: 'Background',
    color: '#64748b',
    surface: 'rgba(100, 116, 139, 0.14)',
    border: 'rgba(100, 116, 139, 0.35)'
  },
  decision: {
    label: 'Decision',
    color: '#0f766e',
    surface: 'rgba(15, 118, 110, 0.14)',
    border: 'rgba(20, 184, 166, 0.4)'
  },
  constraint: {
    label: 'Constraint',
    color: '#be123c',
    surface: 'rgba(190, 18, 60, 0.13)',
    border: 'rgba(244, 63, 94, 0.35)'
  },
  goal: {
    label: 'Goal',
    color: '#2563eb',
    surface: 'rgba(37, 99, 235, 0.13)',
    border: 'rgba(59, 130, 246, 0.35)'
  },
  assumption: {
    label: 'Assumption',
    color: '#b45309',
    surface: 'rgba(180, 83, 9, 0.13)',
    border: 'rgba(245, 158, 11, 0.35)'
  },
  open_question: {
    label: 'Open Question',
    color: '#7c3aed',
    surface: 'rgba(124, 58, 237, 0.13)',
    border: 'rgba(139, 92, 246, 0.35)'
  },
  artifact: {
    label: 'Artifact',
    color: '#0369a1',
    surface: 'rgba(3, 105, 161, 0.13)',
    border: 'rgba(56, 189, 248, 0.35)'
  }
};

export function asNodeType(value: string): NodeType {
  if (NODE_TYPES.includes(value as NodeType)) {
    return value as NodeType;
  }
  return 'artifact';
}
