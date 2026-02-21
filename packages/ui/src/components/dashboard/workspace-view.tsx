'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Command,
  Database,
  Loader2,
  Minus,
  Network,
  RefreshCw,
  Search,
  Trash2,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import {
  deleteContextAction,
  deleteNodeAction,
  getGraphData,
  updateNodeData
} from '@/app/actions';
import ForceGraph, { GraphControls } from '@/app/dashboard/ForceGraph';
import { useDashboardState } from '@/components/dashboard/dashboard-state-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import {
  asNodeType,
  GraphNode,
  GraphPayload,
  NODE_TYPE_META,
  NODE_TYPES,
  NodeType
} from '@/lib/graph';
import { cn, formatTimestamp } from '@/lib/ui';

const INITIAL_GRAPH: GraphPayload = { nodes: [], edges: [] };
const INITIAL_VISIBILITY = NODE_TYPES.reduce(
  (acc, type) => ({ ...acc, [type]: true }),
  {} as Record<NodeType, boolean>
);

type CommandAction = {
  id: string;
  label: string;
  hint: string;
  run: () => void;
};

export default function WorkspaceView() {
  const graphControlsRef = useRef<GraphControls | null>(null);
  const {
    activeContext,
    activeContextId,
    daemonOnline,
    methodCount,
    refreshDashboardData,
    refreshTick,
    requestCount
  } = useDashboardState();

  const [graphData, setGraphData] = useState<GraphPayload>(INITIAL_GRAPH);
  const [graphLoading, setGraphLoading] = useState(true);
  const [graphError, setGraphError] = useState<string | null>(null);

  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [typeVisibility, setTypeVisibility] =
    useState<Record<NodeType, boolean>>(INITIAL_VISIBILITY);

  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');

  const activeNode = useMemo(
    () => graphData.nodes.find(node => node.id === activeNodeId) ?? null,
    [activeNodeId, graphData.nodes]
  );

  const refreshGraph = useCallback(async (contextId: string) => {
    setGraphLoading(true);
    setGraphError(null);
    try {
      const data = await getGraphData(contextId);
      setGraphData(data ?? INITIAL_GRAPH);
    } catch (error) {
      setGraphError(error instanceof Error ? error.message : 'Failed to fetch graph data.');
      setGraphData(INITIAL_GRAPH);
    } finally {
      setGraphLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeContextId) {
      setGraphData(INITIAL_GRAPH);
      setGraphLoading(false);
      setGraphError(null);
      setActiveNodeId(null);
      return;
    }
    void refreshGraph(activeContextId);
  }, [activeContextId, refreshGraph, refreshTick]);

  useEffect(() => {
    if (activeNodeId && !graphData.nodes.some(node => node.id === activeNodeId)) {
      setActiveNodeId(null);
    }
  }, [activeNodeId, graphData.nodes]);

  useEffect(() => {
    if (!activeNode) {
      setEditContent('');
      setEditTags('');
      return;
    }
    setEditContent(activeNode.content);
    setEditTags((activeNode.tags ?? []).join(', '));
  }, [activeNode]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(current => !current);
      }
      if (event.key === 'Escape') {
        setCommandOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const filteredGraph = useMemo(() => {
    const visibleNodes = graphData.nodes.filter(node => typeVisibility[asNodeType(node.type)]);
    const visibleIds = new Set(visibleNodes.map(node => node.id));
    const visibleEdges = graphData.edges.filter(
      edge => visibleIds.has(edge.fromId) && visibleIds.has(edge.toId)
    );
    return {
      nodes: visibleNodes,
      edges: visibleEdges
    };
  }, [graphData.edges, graphData.nodes, typeVisibility]);

  const isDirty = useMemo(() => {
    if (!activeNode) return false;
    const normalizedTags = (activeNode.tags ?? []).join(', ');
    return editContent !== activeNode.content || editTags !== normalizedTags;
  }, [activeNode, editContent, editTags]);

  const commandActions = useMemo<CommandAction[]>(
    () => [
      {
        id: 'fit-graph',
        label: 'Fit graph to viewport',
        hint: 'Canvas',
        run: () => {
          graphControlsRef.current?.fit();
          setCommandOpen(false);
        }
      },
      {
        id: 'refresh-graph',
        label: 'Refresh graph data',
        hint: 'Sync',
        run: () => {
          if (activeContextId) {
            void refreshGraph(activeContextId);
          }
          setCommandOpen(false);
        }
      },
      {
        id: 'refresh-dashboard',
        label: 'Refresh dashboard state',
        hint: 'Status',
        run: () => {
          void refreshDashboardData();
          setCommandOpen(false);
        }
      },
      {
        id: 'clear-selection',
        label: 'Clear selected node',
        hint: 'Inspector',
        run: () => {
          setActiveNodeId(null);
          setCommandOpen(false);
        }
      }
    ],
    [activeContextId, refreshDashboardData, refreshGraph]
  );

  const nodeSearchHits = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) return [];

    return graphData.nodes
      .filter(node => {
        const tagText = (node.tags ?? []).join(' ').toLowerCase();
        return (
          node.content.toLowerCase().includes(query) ||
          String(node.type).toLowerCase().includes(query) ||
          tagText.includes(query)
        );
      })
      .slice(0, 8);
  }, [commandQuery, graphData.nodes]);

  const handleSave = useCallback(async () => {
    if (!activeNodeId) return;
    setIsSaving(true);
    try {
      const tags = editTags
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
      await updateNodeData(activeNodeId, { content: editContent, tags });
      if (activeContextId) await refreshGraph(activeContextId);
    } finally {
      setIsSaving(false);
    }
  }, [activeContextId, activeNodeId, editContent, editTags, refreshGraph]);

  const handleDeleteContext = useCallback(async () => {
    if (!activeContext) return;
    const confirmed = window.confirm(
      `Delete context "${activeContext.name}"? This cannot be undone.`
    );
    if (!confirmed) return;

    await deleteContextAction(activeContext.id);
    await refreshDashboardData();
  }, [activeContext, refreshDashboardData]);

  const handleDeleteNode = useCallback(async () => {
    if (!activeContextId || !activeNodeId) return;
    const confirmed = window.confirm('Delete selected node?');
    if (!confirmed) return;
    await deleteNodeAction(activeContextId, activeNodeId);
    setActiveNodeId(null);
    await refreshGraph(activeContextId);
  }, [activeContextId, activeNodeId, refreshGraph]);

  const toggleTypeVisibility = useCallback((nodeType: NodeType) => {
    setTypeVisibility(previous => ({
      ...previous,
      [nodeType]: !previous[nodeType]
    }));
  }, []);

  const inspectorContent = (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border-muted)] px-4 py-3">
        <p className="text-[11px] uppercase tracking-[0.15em] text-[var(--text-muted)]">Inspector</p>
        <h2 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
          {activeNode ? 'Selected Node' : 'No Selection'}
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeNode ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge
                className="border-[var(--accent-border)]"
                style={{
                  backgroundColor: NODE_TYPE_META[asNodeType(activeNode.type)].surface,
                  borderColor: NODE_TYPE_META[asNodeType(activeNode.type)].border,
                  color: NODE_TYPE_META[asNodeType(activeNode.type)].color
                }}
              >
                {NODE_TYPE_META[asNodeType(activeNode.type)].label}
              </Badge>
              <span className="text-xs text-[var(--text-muted)]">
                {formatTimestamp(activeNode.createdAt)}
              </span>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Content
              </label>
              <textarea
                value={editContent}
                onChange={event => setEditContent(event.target.value)}
                className="min-h-36 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus-ring)]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Tags
              </label>
              <input
                value={editTags}
                onChange={event => setEditTags(event.target.value)}
                placeholder="security, infra, rollout"
                className="h-9 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus-ring)]"
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-44 flex-col items-center justify-center gap-3 text-center">
            <Network className="h-5 w-5 text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">
              Pick a node in the graph to inspect details.
            </p>
          </div>
        )}
      </div>

      {activeNode && (
        <div className="flex gap-2 border-t border-[var(--border-muted)] p-4">
          <Button onClick={() => void handleSave()} disabled={!isDirty || isSaving} variant="primary" className="flex-1">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
          <Button variant="danger" onClick={() => void handleDeleteNode()}>
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0">
      <main className="flex min-w-0 flex-1 flex-col gap-3 p-3 md:p-4">
        <Panel className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => graphControlsRef.current?.fit()}>
              <Search className="h-4 w-4" />
              Fit
            </Button>
            <Button variant="secondary" size="sm" onClick={() => graphControlsRef.current?.reset()}>
              <RefreshCw className="h-4 w-4" />
              Reset
            </Button>
            <Button variant="ghost" size="sm" onClick={() => graphControlsRef.current?.zoomIn()}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => graphControlsRef.current?.zoomOut()}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setActiveNodeId(null)}>
              <Minus className="h-4 w-4" />
              Clear
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setCommandOpen(true)}>
              <Command className="h-4 w-4" />
              Command
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge muted>
              <Database className="mr-1.5 h-3.5 w-3.5" />
              {filteredGraph.nodes.length} nodes
            </Badge>
            <Badge muted>
              <Network className="mr-1.5 h-3.5 w-3.5" />
              {filteredGraph.edges.length} edges
            </Badge>
            {activeContext && (
              <Button variant="danger" size="sm" onClick={() => void handleDeleteContext()}>
                <Trash2 className="h-4 w-4" />
                Delete context
              </Button>
            )}
          </div>
        </Panel>

        <Panel className="relative h-[min(72vh,760px)] min-h-[420px] overflow-hidden">
          {graphLoading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-strong)]" />
              <p className="text-sm text-[var(--text-muted)]">Loading graph workspace...</p>
            </div>
          ) : graphError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm font-medium text-[var(--text-primary)]">Unable to load graph</p>
              <p className="text-sm text-[var(--text-muted)]">{graphError}</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (activeContextId) {
                    void refreshGraph(activeContextId);
                  }
                }}
              >
                Retry
              </Button>
            </div>
          ) : filteredGraph.nodes.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <Database className="h-6 w-6 text-[var(--text-muted)]" />
              <p className="text-sm font-medium text-[var(--text-primary)]">No graph data in this view</p>
              <p className="max-w-md text-sm text-[var(--text-muted)]">
                Add nodes in your active context or relax filters to display relationships.
              </p>
            </div>
          ) : (
            <ForceGraph
              graphData={filteredGraph}
              activeNodeId={activeNodeId}
              onNodeClick={setActiveNodeId}
              onBackgroundClick={() => setActiveNodeId(null)}
              onGraphReady={controls => {
                graphControlsRef.current = controls;
              }}
            />
          )}
        </Panel>

        <Panel className="p-3">
          <div className="mb-2 flex flex-wrap gap-2">
            {NODE_TYPES.map(type => {
              const meta = NODE_TYPE_META[type];
              const active = typeVisibility[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleTypeVisibility(type)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--text-muted)] opacity-70 hover:opacity-100'
                  )}
                  style={{
                    borderColor: active ? meta.border : 'var(--border-muted)',
                    backgroundColor: active ? meta.surface : 'var(--surface-subtle)'
                  }}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <div className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Daemon</p>
              <p className="mt-1 text-sm font-semibold">{daemonOnline ? 'Healthy' : 'Offline'}</p>
            </div>
            <div className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Methods</p>
              <p className="mt-1 text-sm font-semibold">{methodCount || '-'}</p>
            </div>
            <div className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Requests</p>
              <p className="mt-1 text-sm font-semibold">{requestCount ?? '-'}</p>
            </div>
          </div>
        </Panel>

        <Panel className="xl:hidden">{inspectorContent}</Panel>
      </main>

      <aside className="hidden w-[340px] border-l border-[var(--border-muted)] xl:block">
        <Panel className="h-full rounded-none border-0">{inspectorContent}</Panel>
      </aside>

      {commandOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-4 pt-[12vh]"
          onClick={() => setCommandOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-xl border border-[var(--border-muted)] bg-[var(--surface-raised)] p-3 shadow-[var(--shadow-float)]"
            onClick={event => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3">
              <Search className="h-4 w-4 text-[var(--text-muted)]" />
              <input
                autoFocus
                value={commandQuery}
                onChange={event => setCommandQuery(event.target.value)}
                placeholder="Search nodes or run an action"
                className="h-10 w-full bg-transparent text-sm outline-none"
              />
              <span className="text-xs text-[var(--text-muted)]">Esc</span>
            </div>

            <div className="space-y-3">
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  Actions
                </p>
                <div className="space-y-1">
                  {commandActions
                    .filter(action =>
                      commandQuery.trim()
                        ? `${action.label} ${action.hint}`.toLowerCase().includes(commandQuery.toLowerCase())
                        : true
                    )
                    .map(action => (
                      <button
                        key={action.id}
                        type="button"
                        onClick={action.run}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--surface-subtle)]"
                      >
                        <span>{action.label}</span>
                        <span className="text-xs text-[var(--text-muted)]">{action.hint}</span>
                      </button>
                    ))}
                </div>
              </div>

              {nodeSearchHits.length > 0 && (
                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    Node Results
                  </p>
                  <div className="space-y-1">
                    {nodeSearchHits.map((node: GraphNode) => (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => {
                          setActiveNodeId(node.id);
                          graphControlsRef.current?.focusNode(node.id);
                          setCommandOpen(false);
                        }}
                        className="w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--surface-subtle)]"
                      >
                        <p className="truncate text-sm text-[var(--text-primary)]">{node.content}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {NODE_TYPE_META[asNodeType(node.type)].label}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {commandQuery.trim() && nodeSearchHits.length === 0 && (
                <p className="px-2 pb-1 text-sm text-[var(--text-muted)]">
                  No matching nodes for &quot;{commandQuery}&quot;.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
