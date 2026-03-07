'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X
} from 'lucide-react';
import {
  addNodeAction,
  deleteContextAction,
  deleteNodeAction,
  getGraphData,
  getNodePayloadAction,
  listChatSessionsAction,
  listChatTurnsAction,
  updateNodeData
} from '@/app/actions';
import ForceGraph, { GraphControls } from '@/app/dashboard/ForceGraph';
import { useDashboardState } from '@/components/dashboard/dashboard-state-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import {
  asNodeType,
  type ChatSessionSummary,
  type ChatTurnSummary,
  type GraphNode,
  type GraphPayload,
  type NodePayloadRecord,
  NODE_TYPE_META,
  NODE_TYPES,
  type NodeType
} from '@/lib/graph';
import { cn, formatTimestamp } from '@/lib/ui';

const EMPTY_GRAPH: GraphPayload = { nodes: [], edges: [] };
const INITIAL_VISIBILITY = NODE_TYPES.reduce((acc, type) => ({ ...acc, [type]: true }), {} as Record<NodeType, boolean>);

function compact(value: string, max = 90): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

export default function WorkspaceView() {
  const graphControlsRef = useRef<GraphControls | null>(null);
  const { activeContext, activeContextId, selectedMachineId, daemonOnline, methodCount, requestCount, refreshDashboardData, refreshTick } = useDashboardState();

  const [graphData, setGraphData] = useState<GraphPayload>(EMPTY_GRAPH);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [showSessionNodes, setShowSessionNodes] = useState(false);
  const [typeVisibility, setTypeVisibility] = useState<Record<NodeType, boolean>>(INITIAL_VISIBILITY);

  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurnSummary[]>([]);
  const [turnsLoading, setTurnsLoading] = useState(false);

  const [selectedTurn, setSelectedTurn] = useState<ChatTurnSummary | null>(null);
  const [payloadLoading, setPayloadLoading] = useState(false);
  const [payload, setPayload] = useState<NodePayloadRecord | null>(null);
  const [showRawPayload, setShowRawPayload] = useState(false);

  const activeNode = useMemo(() => graphData.nodes.find(node => node.id === activeNodeId) ?? null, [graphData.nodes, activeNodeId]);

  const refreshGraph = useCallback(async (contextId: string) => {
    setGraphLoading(true);
    setGraphError(null);
    try {
      const next = await getGraphData(contextId, selectedMachineId, { includeHidden: showSessionNodes });
      setGraphData(next);
    } catch (error) {
      setGraphError(error instanceof Error ? error.message : 'Failed to load graph');
      setGraphData(EMPTY_GRAPH);
    } finally {
      setGraphLoading(false);
    }
  }, [selectedMachineId, showSessionNodes]);

  const refreshSessions = useCallback(async (contextId: string) => {
    setSessionsLoading(true);
    try {
      const next = await listChatSessionsAction(contextId, selectedMachineId);
      setSessions(next);
      setSelectedSessionId(prev => prev && next.some(item => item.sessionId === prev) ? prev : (next[0]?.sessionId ?? null));
    } finally {
      setSessionsLoading(false);
    }
  }, [selectedMachineId]);

  const refreshTurns = useCallback(async (contextId: string, sessionId: string) => {
    setTurnsLoading(true);
    try {
      setTurns(await listChatTurnsAction(contextId, sessionId, selectedMachineId));
    } finally {
      setTurnsLoading(false);
    }
  }, [selectedMachineId]);

  useEffect(() => {
    if (!activeContextId) {
      setGraphData(EMPTY_GRAPH);
      setSessions([]);
      setTurns([]);
      setSelectedTurn(null);
      return;
    }
    void Promise.all([refreshGraph(activeContextId), refreshSessions(activeContextId)]);
  }, [activeContextId, refreshGraph, refreshSessions, refreshTick]);

  useEffect(() => {
    if (!activeContextId || !selectedSessionId) {
      setTurns([]);
      return;
    }
    void refreshTurns(activeContextId, selectedSessionId);
  }, [activeContextId, selectedSessionId, refreshTurns]);

  useEffect(() => {
    if (!activeNode) {
      setEditContent('');
      setEditTags('');
      return;
    }
    setEditContent(activeNode.content);
    setEditTags((activeNode.tags ?? []).join(', '));
  }, [activeNode]);

  const filteredGraph = useMemo(() => {
    const nodes = graphData.nodes.filter(node => typeVisibility[asNodeType(node.type)]);
    const visible = new Set(nodes.map(node => node.id));
    return { nodes, edges: graphData.edges.filter(edge => visible.has(edge.fromId) && visible.has(edge.toId)) };
  }, [graphData, typeVisibility]);

  const saveNode = useCallback(async () => {
    if (!activeNodeId) return;
    setIsSaving(true);
    try {
      const tags = editTags.split(',').map(value => value.trim()).filter(Boolean);
      await updateNodeData(activeNodeId, { content: editContent, tags }, selectedMachineId);
      if (activeContextId) await refreshGraph(activeContextId);
    } finally {
      setIsSaving(false);
    }
  }, [activeContextId, activeNodeId, editContent, editTags, refreshGraph, selectedMachineId]);

  const openTurn = useCallback(async (turn: ChatTurnSummary) => {
    setSelectedTurn(turn);
    setShowRawPayload(false);
    setPayload(null);
    if (!turn.hasPayload) return;
    setPayloadLoading(true);
    try {
      setPayload(await getNodePayloadAction(turn.nodeId, selectedMachineId));
    } finally {
      setPayloadLoading(false);
    }
  }, [selectedMachineId]);

  return (
    <div className="flex h-full min-h-0">
      <main className="flex min-w-0 flex-1 flex-col gap-3 p-3 md:p-4">
        <Panel className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => graphControlsRef.current?.fit()}><Search className="h-4 w-4" />Fit</Button>
            <Button variant="secondary" size="sm" onClick={() => graphControlsRef.current?.reset()}><RefreshCw className="h-4 w-4" />Reset</Button>
            <Button variant={showSessionNodes ? 'primary' : 'secondary'} size="sm" onClick={() => setShowSessionNodes(current => !current)}>
              {showSessionNodes ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {showSessionNodes ? 'Hide Session Nodes' : 'Show Session Nodes'}
            </Button>
            <Button variant="primary" size="sm" disabled={!activeContextId} onClick={async () => {
              if (!activeContextId) return;
              const created = await addNodeAction(activeContextId, { type: 'decision', content: 'New node' }, selectedMachineId);
              if (created) setActiveNodeId(created.id);
              await refreshGraph(activeContextId);
            }}><Plus className="h-4 w-4" />Add Node</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge muted><Database className="mr-1.5 h-3.5 w-3.5" />{filteredGraph.nodes.length} nodes</Badge>
            <Badge muted><Network className="mr-1.5 h-3.5 w-3.5" />{filteredGraph.edges.length} edges</Badge>
            <Badge muted><CalendarClock className="mr-1.5 h-3.5 w-3.5" />{sessions.length} sessions</Badge>
            {activeContext ? <Button variant="danger" size="sm" onClick={async () => {
              const confirmed = window.confirm(`Delete context \"${activeContext.name}\"? This cannot be undone.`);
              if (!confirmed) return;
              await deleteContextAction(activeContext.id, selectedMachineId);
              await refreshDashboardData();
            }}><Trash2 className="h-4 w-4" />Delete context</Button> : null}
          </div>
        </Panel>

        <Panel className="relative h-[min(72vh,760px)] min-h-[420px] overflow-hidden">
          {graphLoading ? <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : null}
          {graphError ? <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--text-muted)]">{graphError}</div> : null}
          {!graphLoading && !graphError && filteredGraph.nodes.length > 0 ? (
            <ForceGraph
              graphData={filteredGraph}
              activeNodeId={activeNodeId}
              onNodeClick={setActiveNodeId}
              onBackgroundClick={() => setActiveNodeId(null)}
              onGraphReady={controls => { graphControlsRef.current = controls; }}
            />
          ) : null}
        </Panel>

        <Panel className="p-3">
          <div className="mb-2 flex flex-wrap gap-2">
            {NODE_TYPES.map(type => (
              <button
                key={type}
                type="button"
                onClick={() => setTypeVisibility(prev => ({ ...prev, [type]: !prev[type] }))}
                className={cn('rounded-full border px-2.5 py-1 text-xs', typeVisibility[type] ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]')}
              >
                {NODE_TYPE_META[type].label}
              </button>
            ))}
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <MetaBox label="Daemon" value={daemonOnline ? 'Healthy' : 'Offline'} />
            <MetaBox label="Methods" value={String(methodCount || '-')} />
            <MetaBox label="Requests" value={String(requestCount ?? '-')} />
          </div>
        </Panel>
      </main>

      <aside className="hidden w-[420px] border-l border-[var(--border-muted)] xl:flex xl:flex-col">
        <Panel className="h-1/2 rounded-none border-0 border-b border-[var(--border-muted)] p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Inspector</p>
          {!activeNode ? <p className="mt-3 text-sm text-[var(--text-muted)]">Select a node to inspect.</p> : (
            <div className="mt-3 space-y-2">
              <textarea value={editContent} onChange={event => setEditContent(event.target.value)} className="min-h-32 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--surface-raised)] px-3 py-2 text-sm" />
              <input value={editTags} onChange={event => setEditTags(event.target.value)} className="h-9 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--surface-raised)] px-3 text-sm" />
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1" onClick={() => void saveNode()} disabled={isSaving}>{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Save</Button>
                <Button variant="danger" onClick={async () => {
                  if (!activeContextId || !activeNodeId) return;
                  const confirmed = window.confirm('Delete selected node?');
                  if (!confirmed) return;
                  await deleteNodeAction(activeContextId, activeNodeId, selectedMachineId);
                  setActiveNodeId(null);
                  await refreshGraph(activeContextId);
                }}><Trash2 className="h-4 w-4" />Delete</Button>
              </div>
            </div>
          )}
        </Panel>

        <Panel className="h-1/2 rounded-none border-0 p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Sessions</p>
          {sessionsLoading ? <div className="mt-3 text-xs text-[var(--text-muted)]">Loading sessions...</div> : (
            <div className="mt-3 grid min-h-0 grid-rows-[auto,1fr] gap-2">
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {sessions.map(session => (
                  <button key={session.sessionId} type="button" onClick={() => setSelectedSessionId(session.sessionId)} className={cn('w-full rounded-lg border px-2 py-1 text-left text-xs', selectedSessionId === session.sessionId ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]' : 'border-[var(--border-muted)]')}>
                    <p className="font-medium text-[var(--text-primary)]">{compact(session.summary || session.sessionId, 58)}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{session.turnCount} turns • {formatTimestamp(session.lastTurnAt)}</p>
                  </button>
                ))}
              </div>
              <div className="space-y-1 overflow-y-auto">
                {turnsLoading ? <p className="text-xs text-[var(--text-muted)]">Loading turns...</p> : turns.map(turn => (
                  <button key={turn.nodeId} type="button" onClick={() => void openTurn(turn)} className="w-full rounded-lg border border-[var(--border-muted)] px-2 py-1 text-left text-xs">
                    <p className="text-[10px] uppercase text-[var(--text-muted)]">{turn.role ?? 'turn'} • {formatTimestamp(turn.createdAt)}</p>
                    <p className="text-[var(--text-primary)]">{compact(turn.content, 84)}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </aside>

      {selectedTurn ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/45" onClick={() => setSelectedTurn(null)}>
          <div className="h-full w-full max-w-[560px] border-l border-[var(--border-muted)] bg-[var(--surface-raised)] p-4" onClick={event => event.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Turn Detail</p>
                <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{compact(selectedTurn.content, 100)}</h3>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedTurn(null)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <MetaBox label="Session" value={selectedTurn.sessionId} mono />
              <MetaBox label="Role" value={selectedTurn.role ?? '-'} />
              <MetaBox label="Branch" value={selectedTurn.branch ?? '-'} />
              <MetaBox label="Commit" value={selectedTurn.commitSha ? selectedTurn.commitSha.slice(0, 12) : '-'} mono />
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="secondary" disabled={!selectedTurn.hasPayload || payloadLoading} onClick={() => setShowRawPayload(current => !current)}>
                {showRawPayload ? 'Hide Raw Payload' : 'Show Raw Payload'}
              </Button>
            </div>
            {showRawPayload ? (
              <div className="mt-3">
                {payloadLoading ? <p className="text-xs text-[var(--text-muted)]">Loading raw payload...</p> : payload ? (
                  <pre className="max-h-[60vh] overflow-auto rounded-lg bg-[var(--surface-subtle)] p-3 text-xs text-[var(--text-secondary)]">{JSON.stringify(payload.payload, null, 2)}</pre>
                ) : <p className="text-xs text-[var(--text-muted)]">No payload found.</p>}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MetaBox({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)]">{label}</p>
      <p className={cn('mt-1 text-sm font-semibold text-[var(--text-primary)]', mono ? 'font-mono' : undefined)}>{value}</p>
    </div>
  );
}
