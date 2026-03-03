'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  Background,
  Controls,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { asNodeType, GraphPayload, NODE_TYPE_META } from '@/lib/graph';
import * as d3 from 'd3-force';
import dagre from 'dagre';
import type { LayoutTypes } from 'reagraph'; // kept for backward compatibility

export interface GraphControls {
  fit: () => void;
  reset: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  focusNode: (nodeId: string) => void;
}

interface FlowNodeData extends Record<string, unknown> {
  label: string;
  type: string;
  raw: unknown;
  size: number;
}

type FlowNode = Node<FlowNodeData>;
type FlowEdge = Edge;
type SimNode = FlowNode & { x: number; y: number };

function CustomNode({ data, selected }: { data: FlowNodeData; selected?: boolean }) {
  const meta = NODE_TYPE_META[asNodeType(data.type)];
  const size = data.size || 32;

  return (
    <div
      className="relative flex flex-col items-center justify-center cursor-pointer"
      style={{
        width: `${size}px`,
        height: `${size}px`,
      }}
    >
      <div
        className={`absolute inset-0 rounded-full transition-all duration-300 ${selected ? 'ring-2 ring-offset-2 ring-offset-[var(--surface-base)] scale-110' : 'hover:scale-110'}`}
        style={{
          backgroundColor: meta?.color || '#333333',
          opacity: 0.35,
          border: `1px solid ${meta?.color || '#444444'}`,
          boxShadow: selected ? `0 0 20px 2px ${meta?.color || '#333333'}` : 'none'
        }}
      />

      <Handle type="target" position={Position.Top} className="opacity-0 w-0 h-0" />
      <Handle type="source" position={Position.Bottom} className="opacity-0 w-0 h-0" />

      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-max max-w-[150px] text-center pointer-events-none z-10"
        title={data.label}
      >
        <span
          className="text-[11px] font-medium tracking-wide whitespace-pre-wrap"
          style={{
            color: '#f8fafc',
            textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 2px 6px rgba(0,0,0,0.9)'
          }}
        >
          {data.label}
        </span>
      </div>
    </div>
  );
}

const nodeTypes = {
  custom: CustomNode,
};

export interface ForceGraphProps {
  graphData: GraphPayload;
  activeNodeId?: string | null;
  layoutType?: LayoutTypes;
  clusterAttribute?: string;
  onNodeClick?: (id: string) => void;
  onBackgroundClick?: () => void;
  onGraphReady?: (controls: GraphControls) => void;
}

function FlowEngine({
  graphData,
  activeNodeId,
  layoutType,
  clusterAttribute,
  onNodeClick,
  onBackgroundClick,
  onGraphReady
}: ForceGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const { fitView, setCenter, zoomIn, zoomOut, getNodes } = useReactFlow<FlowNode, FlowEdge>();
  const simulationRunningRef = useRef(false);

  useEffect(() => {
    // Calculate node degrees for sizing
    const nodeDegree: Record<string, number> = {};
    graphData.edges.forEach(e => {
      nodeDegree[e.fromId] = (nodeDegree[e.fromId] || 0) + 1;
      nodeDegree[e.toId] = (nodeDegree[e.toId] || 0) + 1;
    });

    // Generate raw nodes and edges based on real graph connectivity
    const rawNodes: SimNode[] = graphData.nodes.map(n => {
      const label = String(n.content || n.type || '').trim();
      const shortLabel = label.length > 28 ? `${label.slice(0, 25)}...` : label;
      const x = 400 + (Math.random() - 0.5) * 100;
      const y = 300 + (Math.random() - 0.5) * 100;

      const degree = nodeDegree[n.id] || 0;
      const size = Math.min(100, Math.max(24, 20 + degree * 12));

      return {
        id: String(n.id),
        type: 'custom',
        x,
        y,
        position: { x, y },
        data: { label: shortLabel, type: n.type, raw: n, size }
      };
    });

    const rawEdges: FlowEdge[] = graphData.edges.map(e => ({
      id: String(e.id),
      source: String(e.fromId),
      target: String(e.toId),
      label: '',
      type: 'default',
      animated: false,
      style: { stroke: '#475569', strokeWidth: 1.5, opacity: 0.35 },
    }));

    if (layoutType === 'hierarchicalTd' || layoutType === 'treeTd2d' || layoutType === 'treeLr2d') {
      const isLR = layoutType === 'treeLr2d';
      const g = new dagre.graphlib.Graph();
      g.setGraph({ rankdir: isLR ? 'LR' : 'TD', marginx: 50, marginy: 50, ranksep: 120, nodesep: 150 });
      g.setDefaultEdgeLabel(() => ({}));

      rawNodes.forEach(n => g.setNode(n.id, { width: 100, height: 100 }));
      rawEdges.forEach(e => g.setEdge(e.source, e.target));

      dagre.layout(g);

      const laidOutNodes = rawNodes.map(n => {
        const nodeWithPosition = g.node(n.id);
        return {
          ...n,
          position: {
            x: nodeWithPosition.x - 50,
            y: nodeWithPosition.y - 50,
          }
        };
      });

      setNodes(laidOutNodes);
      setEdges(rawEdges);
      setTimeout(() => fitView({ padding: 0.2, duration: 800 }), 100);

    } else {
      // Force Directed Layout
      simulationRunningRef.current = true;
      const d3Links = rawEdges.map(e => ({ source: e.source, target: e.target }));
      const simulation = d3.forceSimulation<SimNode>(rawNodes)
        .force('link', d3.forceLink<SimNode, { source: string | SimNode; target: string | SimNode }>(d3Links).id((d) => d.id).distance(120))
        .force('charge', d3.forceManyBody().strength(-600))
        .force('center', d3.forceCenter(400, 300))
        .force('collide', d3.forceCollide<SimNode>().radius((d) => (d.data?.size || 32) / 2 + 15));

      if (clusterAttribute) {
        simulation.force('x', d3.forceX<SimNode>().x((d) => {
          const charCode = (d.data.type || '').charCodeAt(0) || 0;
          return 400 + ((charCode % 3) - 1) * 300;
        }).strength(0.3));
        simulation.force('y', d3.forceY<SimNode>().y((d) => {
          const charCode = (d.data.type || '').charCodeAt(1) || 0;
          return 300 + ((charCode % 3) - 1) * 300;
        }).strength(0.3));
      }

      simulation.on('tick', () => {
        setNodes(rawNodes.map((n) => ({
          ...n,
          position: { x: n.x, y: n.y }
        })));
      });

      simulation.on('end', () => {
        simulationRunningRef.current = false;
        fitView({ padding: 0.3, duration: 1000 });
      });

      setNodes(rawNodes.map((n) => ({
        ...n,
        position: { x: n.x, y: n.y }
      })));
      setEdges(rawEdges);

      return () => {
        simulation.stop();
        simulationRunningRef.current = false;
      };
    }
  }, [graphData, layoutType, clusterAttribute, setNodes, setEdges, fitView]);

  useEffect(() => {
    setNodes(nds =>
      nds.map(n => ({
        ...n,
        selected: n.id === activeNodeId,
      }))
    );
    if (!simulationRunningRef.current && activeNodeId) {
      const activeNode = getNodes().find(n => n.id === activeNodeId);
      if (activeNode) {
        setCenter(activeNode.position.x + 28, activeNode.position.y + 28, { zoom: 1.2, duration: 800 });
      }
    }
  }, [activeNodeId, setNodes, getNodes, setCenter]);

  const fit = useCallback(() => {
    fitView({ padding: 0.2, duration: 800 });
  }, [fitView]);

  const reset = useCallback(() => {
    fitView({ padding: 0.2, duration: 800 });
  }, [fitView]);

  const focusNodeObj = useCallback((nodeId: string) => {
    const n = getNodes().find(nd => nd.id === nodeId);
    if (n) {
      setCenter(n.position.x + 28, n.position.y + 28, { zoom: 1.2, duration: 800 });
    }
  }, [getNodes, setCenter]);

  useEffect(() => {
    if (onGraphReady) {
      onGraphReady({
        fit,
        reset,
        zoomIn: () => zoomIn({ duration: 400 }),
        zoomOut: () => zoomOut({ duration: 400 }),
        focusNode: focusNodeObj
      });
    }
  }, [fit, onGraphReady, reset, zoomIn, zoomOut, focusNodeObj]);

  return (
    <ReactFlow<FlowNode, FlowEdge>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_, node) => {
        if (onNodeClick) onNodeClick(node.id);
      }}
      onPaneClick={() => {
        if (onBackgroundClick) onBackgroundClick();
      }}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
      className="bg-transparent"
    >
      <Background color="#cbd5e1" gap={24} size={2} style={{ opacity: 0.15 }} />
      <Controls
        className="!bg-[var(--surface-raised)] !backdrop-blur-none !shadow-lg !overflow-hidden !border !border-[var(--border-muted)] !rounded-full [&_button]:!bg-[var(--surface-raised)] [&_button]:!border-b [&_button]:!border-[var(--border-muted)] hover:[&_button]:!bg-[var(--accent-soft)] last:[&_button]:!border-b-0 py-1 [&_svg]:!fill-[var(--text-muted)] hover:[&_svg]:!fill-[var(--accent-color)]"
        showInteractive={false}
      />
    </ReactFlow>
  );
}

export default function ForceGraph(props: ForceGraphProps) {
  return (
    <div className="absolute inset-0 h-full w-full bg-[var(--surface-base)] rounded-lg overflow-hidden">
      <ReactFlowProvider>
        <FlowEngine {...props} />
      </ReactFlowProvider>
    </div>
  );
}
