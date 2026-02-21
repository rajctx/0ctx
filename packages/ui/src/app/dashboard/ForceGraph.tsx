'use client';
import { useEffect, useRef, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import react-force-graph-2d to avoid SSR issues
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

export default function ForceGraph({ graphData, onNodeClick, activeNodeId }: { graphData: any, onNodeClick?: (id: string) => void, activeNodeId?: string | null }) {
    const fgRef = useRef<any>(null);
    const [dimensions, setDimensions] = useState({ width: 800, height: 800 });
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (containerRef.current) {
            setDimensions({
                width: containerRef.current.clientWidth,
                height: containerRef.current.clientHeight
            });
        }

        const handleResize = () => {
            if (containerRef.current) {
                setDimensions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight
                });
            }
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const graphDataFormatted = useMemo(() => ({
        nodes: graphData.nodes.map((n: any) => ({ ...n, name: n.type + ': ' + n.id.split('-')[0] })),
        links: graphData.edges.map((e: any) => ({ source: e.fromId, target: e.toId, name: e.relation }))
    }), [graphData]);

    return (
        <div ref={containerRef} className="w-full h-full relative">
            <ForceGraph2D
                ref={fgRef}
                width={dimensions.width}
                height={dimensions.height}
                graphData={graphDataFormatted}
                nodeId="id"
                nodeLabel="name"
                nodeColor={node => {
                    if (node.id === activeNodeId) return '#111111';
                    if (node.type === 'goal') return '#2F80ED';
                    if (node.type === 'decision') return '#397554';
                    if (node.type === 'constraint') return '#EB5757';
                    return '#9B51E0';
                }}
                nodeRelSize={4}
                linkColor={(link: any) => {
                    if (link.source.id === activeNodeId || link.target.id === activeNodeId) {
                        return 'rgba(0, 0, 0, 0.3)';
                    }
                    return 'rgba(0, 0, 0, 0.05)';
                }}
                linkWidth={(link: any) => (link.source.id === activeNodeId || link.target.id === activeNodeId) ? 1.5 : 0.8}
                linkDirectionalArrowLength={3}
                linkDirectionalArrowRelPos={1}
                linkCurvature={0.2}
                linkHoverPrecision={10}
                onNodeClick={(node: any) => {
                    fgRef.current?.centerAt(node.x, node.y, 1000);
                    fgRef.current?.zoom(4, 2000);
                    if (onNodeClick && node.id !== undefined) onNodeClick(String(node.id));
                }}
                nodeCanvasObject={(node, ctx, globalScale) => {
                    const isActive = node.id === activeNodeId;
                    const size = isActive ? 5 : 3;

                    // Clean, professional data visualization colors
                    let color = '#71717a';
                    if (isActive) color = '#111111'; // stark black
                    else if (node.type === 'goal') color = '#2F80ED';
                    else if (node.type === 'decision') color = '#397554';
                    else if (node.type === 'constraint') color = '#EB5757';
                    else if (node.type === 'artifact') color = '#9B51E0'; // purple

                    // Draw elegant hollow or filled circle
                    ctx.beginPath();
                    ctx.arc(node.x || 0, node.y || 0, size, 0, 2 * Math.PI, false);
                    ctx.fillStyle = isActive ? '#ffffff' : color;
                    ctx.fill();

                    if (isActive) {
                        ctx.lineWidth = 2;
                        ctx.strokeStyle = '#111111';
                        ctx.stroke();

                        // Subtle pulsing/selection ring
                        ctx.beginPath();
                        ctx.arc(node.x || 0, node.y || 0, size + 4, 0, 2 * Math.PI, false);
                        ctx.lineWidth = 0.5;
                        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
                        ctx.stroke();
                    } else {
                        // For non-active, add a slight white border for depth against lines
                        ctx.lineWidth = 0.8;
                        ctx.strokeStyle = '#ffffff';
                        ctx.stroke();
                    }

                    // Precise, minimal text
                    if (globalScale > 1.2 || isActive) {
                        const label = node.content ? node.content.substring(0, 24) : node.type;
                        const fontSize = isActive ? 11 / globalScale : 9 / globalScale;

                        ctx.font = `${isActive ? '600 ' : ''}${fontSize}px Inter, system-ui, sans-serif`;

                        // Text shadow for legibility without bulky background pills
                        ctx.shadowColor = '#ffffff';
                        ctx.shadowBlur = 6;
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = 0;

                        ctx.fillStyle = isActive ? '#111111' : '#636363';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'top';
                        ctx.fillText(label, node.x || 0, (node.y || 0) + size + 6);

                        // Reset shadow
                        ctx.shadowBlur = 0;
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = 0;
                    }
                }}
            />
        </div>
    );
}
