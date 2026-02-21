'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { MutableRefObject, ReactElement } from 'react';
import type { ForceGraphMethods, LinkObject, NodeObject } from 'react-force-graph-2d';
import { asNodeType, GraphPayload, NODE_TYPE_META } from '@/lib/graph';

type GraphNodeData = {
  id: string;
  type: string;
  content: string;
  tags?: string[];
  createdAt: number;
  name?: string;
};

type GraphLinkData = {
  id: string;
  relation: string;
  source?: string | number | NodeObject<GraphNodeData>;
  target?: string | number | NodeObject<GraphNodeData>;
};

type DynamicForceGraphProps = {
  ref?: MutableRefObject<ForceGraphMethods<GraphNodeData, GraphLinkData> | undefined>;
  [key: string]: unknown;
};

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false
}) as unknown as (props: DynamicForceGraphProps) => ReactElement;

interface ForceConfig {
  distance?: (value: number) => void;
  strength?: (value: number) => void;
  radius?: (value: number) => void;
}

export interface GraphControls {
  fit: () => void;
  reset: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  focusNode: (nodeId: string) => void;
}

function getEndpointId(endpoint: GraphLinkData['source']): string {
  if (!endpoint) return '';
  if (typeof endpoint === 'object' && endpoint.id !== undefined) {
    return String(endpoint.id);
  }
  return String(endpoint);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export default function ForceGraph({
  graphData,
  activeNodeId,
  onNodeClick,
  onBackgroundClick,
  onGraphReady
}: {
  graphData: GraphPayload;
  activeNodeId?: string | null;
  onNodeClick?: (id: string) => void;
  onBackgroundClick?: () => void;
  onGraphReady?: (controls: GraphControls) => void;
}) {
  const graphRef = useRef<ForceGraphMethods<GraphNodeData, GraphLinkData> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 1200, height: 760 });
  const [palette, setPalette] = useState({
    canvasBg: '#0f172a',
    canvasGrid: 'rgba(148, 163, 184, 0.08)',
    edge: 'rgba(148, 163, 184, 0.24)',
    edgeActive: 'rgba(45, 212, 191, 0.62)',
    nodeFill: '#e2e8f0',
    nodeOutline: 'rgba(8, 15, 24, 0.85)',
    nodeText: '#93c5fd',
    accent: '#14b8a6',
    accentBorder: 'rgba(20, 184, 166, 0.45)'
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setDimensions({
        width: Math.max(320, Math.floor(width)),
        height: Math.max(320, Math.floor(height))
      });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const resolvePalette = () => {
      const styles = getComputedStyle(document.documentElement);
      const get = (key: string, fallback: string) => styles.getPropertyValue(key).trim() || fallback;
      setPalette({
        canvasBg: get('--graph-canvas-bg', '#0f172a'),
        canvasGrid: get('--graph-canvas-grid', 'rgba(148, 163, 184, 0.08)'),
        edge: get('--graph-edge', 'rgba(148, 163, 184, 0.24)'),
        edgeActive: get('--graph-edge-active', 'rgba(45, 212, 191, 0.62)'),
        nodeFill: get('--graph-node-fill', '#e2e8f0'),
        nodeOutline: get('--graph-node-outline', 'rgba(8, 15, 24, 0.85)'),
        nodeText: get('--graph-node-text', '#93c5fd'),
        accent: get('--accent-strong', '#14b8a6'),
        accentBorder: get('--accent-border', 'rgba(20, 184, 166, 0.45)')
      });
    };

    resolvePalette();
    const observer = new MutationObserver(resolvePalette);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
    return () => observer.disconnect();
  }, []);

  const formattedData = useMemo(
    () => ({
      nodes: graphData.nodes.map(
        node =>
          ({
            ...node,
            name: node.content || node.type
          }) as NodeObject<GraphNodeData>
      ),
      links: graphData.edges.map(
        edge =>
          ({
            id: edge.id,
            relation: edge.relation,
            source: edge.fromId,
            target: edge.toId
          }) as LinkObject<GraphNodeData, GraphLinkData>
      )
    }),
    [graphData]
  );

  const fit = useCallback(() => {
    graphRef.current?.zoomToFit(550, 64);
  }, []);

  const reset = useCallback(() => {
    graphRef.current?.centerAt(0, 0, 320);
    graphRef.current?.zoom(1, 320);
  }, []);

  const zoomIn = useCallback(() => {
    const current = graphRef.current?.zoom() ?? 1;
    graphRef.current?.zoom(Math.min(7, current * 1.22), 220);
  }, []);

  const zoomOut = useCallback(() => {
    const current = graphRef.current?.zoom() ?? 1;
    graphRef.current?.zoom(Math.max(0.24, current / 1.22), 220);
  }, []);

  const focusNode = useCallback(
    (nodeId: string) => {
      const node = formattedData.nodes.find(item => item.id === nodeId);
      if (!node || typeof node.x !== 'number' || typeof node.y !== 'number') return;
      graphRef.current?.centerAt(node.x, node.y, 420);
      graphRef.current?.zoom(2.1, 420);
    },
    [formattedData.nodes]
  );

  useEffect(() => {
    if (!onGraphReady) return;
    onGraphReady({
      fit,
      reset,
      zoomIn,
      zoomOut,
      focusNode
    });
  }, [fit, focusNode, onGraphReady, reset, zoomIn, zoomOut]);

  useEffect(() => {
    if (!graphRef.current) return;

    const linkForce = graphRef.current.d3Force('link') as ForceConfig | undefined;
    linkForce?.distance?.(120);
    linkForce?.strength?.(0.45);

    const charge = graphRef.current.d3Force('charge') as ForceConfig | undefined;
    charge?.strength?.(-225);

    const collision = graphRef.current.d3Force('collision') as ForceConfig | undefined;
    collision?.radius?.(17);
  }, [formattedData.nodes.length]);

  useEffect(() => {
    fit();
  }, [fit, graphData.nodes.length, graphData.edges.length]);

  return (
    <div ref={containerRef} className="h-full w-full">
      <ForceGraph2D
        ref={graphRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={formattedData}
        nodeId="id"
        cooldownTicks={130}
        minZoom={0.28}
        maxZoom={7}
        linkCurvature={0}
        linkDirectionalArrowLength={0}
        linkColor={(link: LinkObject<GraphNodeData, GraphLinkData>) => {
          const sourceId = getEndpointId(link.source);
          const targetId = getEndpointId(link.target);
          const isActive = sourceId === activeNodeId || targetId === activeNodeId;
          return isActive ? palette.edgeActive : palette.edge;
        }}
        linkWidth={(link: LinkObject<GraphNodeData, GraphLinkData>) => {
          const sourceId = getEndpointId(link.source);
          const targetId = getEndpointId(link.target);
          return sourceId === activeNodeId || targetId === activeNodeId ? 2 : 1.1;
        }}
        onRenderFramePre={(ctx: CanvasRenderingContext2D) => {
          ctx.fillStyle = palette.canvasBg;
          ctx.fillRect(0, 0, dimensions.width, dimensions.height);
        }}
        nodeCanvasObject={(node: NodeObject<GraphNodeData>, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const id = node.id !== undefined ? String(node.id) : '';
          const typed = asNodeType(String(node.type ?? 'artifact'));
          const meta = NODE_TYPE_META[typed];
          const isActive = id === activeNodeId;
          const x = typeof node.x === 'number' ? node.x : 0;
          const y = typeof node.y === 'number' ? node.y : 0;

          const nodeWidth = isActive ? 14 : 11;
          const nodeHeight = isActive ? 16 : 13;
          const left = x - nodeWidth / 2;
          const top = y - nodeHeight / 2;

          roundRect(ctx, left, top, nodeWidth, nodeHeight, 2.6);
          ctx.fillStyle = palette.nodeFill;
          ctx.fill();
          ctx.lineWidth = isActive ? 1.9 : 1.1;
          ctx.strokeStyle = isActive ? palette.accent : palette.nodeOutline;
          ctx.stroke();

          ctx.fillStyle = meta.color;
          ctx.fillRect(left + 1.1, top + 1.1, nodeWidth - 2.2, 2.4);

          ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
          ctx.beginPath();
          ctx.moveTo(left + nodeWidth - 4, top + 1);
          ctx.lineTo(left + nodeWidth - 1, top + 1);
          ctx.lineTo(left + nodeWidth - 1, top + 4);
          ctx.closePath();
          ctx.fill();

          if (isActive) {
            ctx.lineWidth = 2.1;
            ctx.strokeStyle = palette.accent;
            ctx.stroke();
          }

          if (globalScale > 1 || isActive) {
            const label = String(node.content || node.name || meta.label || '').trim();
            const shortLabel = label.length > 22 ? `${label.slice(0, 19)}...` : label;
            const fontSize = Math.max(8 / globalScale, 5.4);
            ctx.font = `${isActive ? '600' : '500'} ${fontSize}px Manrope, Segoe UI, sans-serif`;
            ctx.fillStyle = palette.nodeText;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(shortLabel, x, y + nodeHeight / 2 + 3.5);
          }
        }}
        nodePointerAreaPaint={(
          node: NodeObject<GraphNodeData>,
          color: string,
          ctx: CanvasRenderingContext2D
        ) => {
          const x = typeof node.x === 'number' ? node.x : 0;
          const y = typeof node.y === 'number' ? node.y : 0;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(x, y, 12, 0, 2 * Math.PI, false);
          ctx.fill();
        }}
        onNodeClick={(node: NodeObject<GraphNodeData>) => {
          if (node.id === undefined) return;
          const id = String(node.id);
          focusNode(id);
          onNodeClick?.(id);
        }}
        onBackgroundClick={() => onBackgroundClick?.()}
      />
    </div>
  );
}
