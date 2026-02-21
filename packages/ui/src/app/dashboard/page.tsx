'use client';
import { useEffect, useState } from 'react';
import { getContexts, getGraphData, updateNodeData, createContext, deleteContextAction, deleteNodeAction } from '../actions';
import ForceGraph from './ForceGraph';
import { Network, Database, Layers, Activity, Save, X, Crosshair, Trash2 } from 'lucide-react';

interface Context {
    id: string;
    name: string;
    createdAt: number;
}
interface Node {
    id: string;
    type: string;
    content: string;
    createdAt: number;
    tags?: string[];
}
interface Edge {
    id: string;
    fromId: string;
    toId: string;
    relation: string;
}

export default function Dashboard() {
    const [contexts, setContexts] = useState<Context[]>([]);
    const [activeContext, setActiveContext] = useState<Context | null>(null);
    const [graphData, setGraphData] = useState<{ nodes: Node[], edges: Edge[] }>({ nodes: [], edges: [] });
    const [loading, setLoading] = useState(true);
    const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

    // Edit state
    const [editContent, setEditContent] = useState('');
    const [editTags, setEditTags] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // Context creation state
    const [isCreatingContext, setIsCreatingContext] = useState(false);
    const [newContextName, setNewContextName] = useState('');

    // Sidebar Layout State
    const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);

    useEffect(() => {
        getContexts().then(res => {
            setContexts(res);
            if (res.length > 0) {
                setActiveContext(res[0]);
            } else {
                setLoading(false);
            }
        }).catch(err => {
            console.error('Failed to connect to daemon', err);
            setLoading(false);
        });
    }, []);

    const refreshGraph = () => {
        if (!activeContext) return;
        setLoading(true);
        getGraphData(activeContext.id).then(data => {
            setGraphData(data);
            setLoading(false);
        });
    };

    useEffect(() => {
        refreshGraph();
    }, [activeContext]);

    // When active node changes, reset edit state
    const activeNode = graphData.nodes.find(n => n.id === activeNodeId);
    useEffect(() => {
        if (activeNode) {
            setEditContent(activeNode.content);
            setEditTags((activeNode.tags || []).join(', '));
        }
    }, [activeNodeId, activeNode]);

    const handleSave = async () => {
        if (!activeNodeId) return;
        setIsSaving(true);
        const tagsArray = editTags.split(',').map(t => t.trim()).filter(t => t.length > 0);
        await updateNodeData(activeNodeId, { content: editContent, tags: tagsArray });
        await refreshGraph();
        setIsSaving(false);
    };

    const handleCreateContext = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!newContextName.trim()) {
            setIsCreatingContext(false);
            return;
        }

        const res = await createContext(newContextName.trim());
        if (res) {
            const ctxs = await getContexts();
            setContexts(ctxs);
            const newlyCreated = ctxs.find((c: Context) => c.name === newContextName.trim());
            if (newlyCreated) setActiveContext(newlyCreated);
        }

        setIsCreatingContext(false);
        setNewContextName('');
    };

    const handleDeleteContext = async () => {
        if (!activeContext) return;
        if (!confirm(`Are you sure you want to delete the workspace "${activeContext.name}"? This action cannot be undone.`)) return;

        await deleteContextAction(activeContext.id);

        const ctxs = await getContexts();
        setContexts(ctxs);
        if (ctxs.length > 0) {
            setActiveContext(ctxs[0]);
        } else {
            setActiveContext(null);
            setGraphData({ nodes: [], edges: [] });
            setActiveNodeId(null);
        }
    };

    const handleDeleteNode = async () => {
        if (!activeNodeId || !activeContext) return;
        if (!confirm('Are you sure you want to delete this node?')) return;

        await deleteNodeAction(activeContext.id, activeNodeId);
        setActiveNodeId(null);
        refreshGraph();
    };

    return (
        <div className="flex h-screen bg-[#FAFAFA] text-[#111111] font-sans overflow-hidden">
            {/* Primary Collapsible Sidebar */}
            <aside
                className={`bg-[#F9F9F9] border-r border-[#EAEAEA] flex flex-col z-40 shrink-0 transition-all duration-300 ease-in-out ${isSidebarExpanded ? 'w-48' : 'w-16 items-center'
                    }`}
            >
                {/* Header Logo area */}
                <div onClick={() => setIsSidebarExpanded(!isSidebarExpanded)} className={`h-16 flex items-center shrink-0 cursor-pointer overflow-hidden ${isSidebarExpanded ? 'px-4' : 'justify-center w-full'}`}>
                    <div className="flex items-center gap-2 font-semibold text-sm tracking-wide text-[#111111] whitespace-nowrap w-full">
                        <div className="w-8 h-8 flex items-center justify-center shrink-0">
                            <Crosshair className="w-5 h-5 text-[#397554]" />
                        </div>
                        <span className={`transition-opacity duration-200 ${isSidebarExpanded ? 'opacity-100' : 'opacity-0 w-0 hidden'}`}>Ona Workspace</span>
                    </div>
                </div>

                <div className={`flex flex-col gap-2 w-full mt-4 ${isSidebarExpanded ? 'px-3' : 'px-2 items-center'}`}>
                    <button title={!isSidebarExpanded ? "Dashboard" : undefined} className={`flex items-center gap-3 rounded-lg text-[#636363] hover:text-[#111111] hover:bg-[#EAEAEA] transition-colors cursor-pointer text-xs font-semibold ${isSidebarExpanded ? 'px-3 py-2 w-full' : 'p-3 justify-center'}`}>
                        <Activity className="w-4 h-4 shrink-0" />
                        <span className={`transition-opacity duration-200 ${isSidebarExpanded ? 'opacity-100' : 'opacity-0 hidden'}`}>Dashboard</span>
                    </button>
                    <button title={!isSidebarExpanded ? "Contexts" : undefined} className={`flex items-center gap-3 rounded-lg text-[#111111] bg-[#EAEAEA] transition-colors cursor-pointer text-xs font-semibold shadow-sm ${isSidebarExpanded ? 'px-3 py-2 w-full' : 'p-3 justify-center'}`}>
                        <Network className="w-4 h-4 shrink-0" />
                        <span className={`transition-opacity duration-200 ${isSidebarExpanded ? 'opacity-100' : 'opacity-0 hidden'}`}>Contexts</span>
                    </button>
                </div>

                <div className="flex-1" />

                <div className={`flex flex-col gap-2 w-full mb-4 ${isSidebarExpanded ? 'px-3' : 'px-2 items-center'}`}>
                    <button title={!isSidebarExpanded ? "Settings" : undefined} className={`flex items-center gap-3 rounded-lg text-[#636363] hover:text-[#111111] hover:bg-[#EAEAEA] transition-colors cursor-pointer text-xs font-semibold ${isSidebarExpanded ? 'px-3 py-2 w-full' : 'p-3 justify-center'}`}>
                        <Layers className="w-4 h-4 shrink-0" />
                        <span className={`transition-opacity duration-200 ${isSidebarExpanded ? 'opacity-100' : 'opacity-0 hidden'}`}>Settings</span>
                    </button>
                </div>
            </aside>

            {/* Secondary Sidebar - Contexts List */}
            <aside className="w-56 border-r border-[#EAEAEA] bg-white flex flex-col z-30 shrink-0">
                <div className="h-16 flex items-center px-5 border-b border-[#EAEAEA] shrink-0">
                    <h2 className="font-semibold text-sm text-[#111111]">Contexts</h2>
                </div>

                <div className="flex-1 overflow-y-auto py-4 px-3 flex flex-col">
                    <nav className="flex flex-col gap-1 flex-1">
                        {contexts.map(ctx => (
                            <button
                                key={ctx.id}
                                onClick={() => setActiveContext(ctx)}
                                className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-xs font-medium border cursor-pointer ${activeContext?.id === ctx.id
                                        ? 'border-[#EAEAEA] bg-[#FAFAFA] text-[#111111] shadow-sm'
                                        : 'border-transparent text-[#636363] hover:text-[#111111] hover:bg-[#FAFAFA]'
                                    }`}
                            >
                                <span className="truncate">{ctx.name}</span>
                            </button>
                        ))}
                    </nav>
                </div>

                {/* Sticking context creator to the bottom */}
                <div className="flex-shrink-0 p-3 pt-2 border-t border-[#EAEAEA]">
                    {isCreatingContext ? (
                        <form onSubmit={handleCreateContext} className="flex flex-col gap-2">
                            <input
                                type="text"
                                autoFocus
                                value={newContextName}
                                onChange={e => setNewContextName(e.target.value)}
                                onBlur={() => handleCreateContext()}
                                placeholder="Context name..."
                                className="w-full bg-white border border-[#EAEAEA] text-[#111111] text-xs rounded-md px-2 py-1.5 focus:outline-none focus:border-[#397554] shadow-sm cursor-text"
                            />
                        </form>
                    ) : (
                        <button
                            onClick={() => setIsCreatingContext(true)}
                            className="flex items-center justify-center gap-1.5 px-2 py-1.5 w-full rounded-md border border-dashed border-[#A0A0A0] text-[#636363] hover:text-[#111111] hover:border-[#111111] hover:bg-[#FAFAFA] transition-colors text-xs font-medium cursor-pointer"
                        >
                            <span className="text-sm leading-none mb-0.5">+</span> New Context
                        </button>
                    )}
                </div>
            </aside>

            {/* Main Center Area */}
            <main className="flex-1 flex flex-col min-w-0 relative">

                {/* Header inside main area for Context info */}
                <header className="h-16 flex items-center justify-between px-6 border-b border-[#EAEAEA] bg-white z-20 shrink-0">
                    <div className="flex items-center gap-4">
                        {activeContext ? (
                            <h1 className="text-lg font-semibold text-[#111111]">{activeContext.name}</h1>
                        ) : (
                            <div className="text-sm font-medium text-[#636363]">No workspace selected</div>
                        )}
                    </div>

                    {activeContext && (
                        <button
                            onClick={handleDeleteContext}
                            className="cursor-pointer px-3 py-1.5 rounded-md text-red-600 bg-white hover:bg-red-50 border border-[#EAEAEA] hover:border-red-100 transition-colors text-xs font-medium flex items-center gap-1.5"
                        >
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                    )}
                </header>

                {/* Graph Canvas Container */}
                <div className="flex-1 overflow-hidden relative flex flex-col min-h-0 bg-[#FAFAFA]">
                    <div className="flex-1 relative overflow-hidden flex flex-col group">

                        {/* Solid crisp background overlay */}
                        <div className="absolute inset-0 bg-[#FAFAFA] z-0 pointer-events-none" />

                        <div className="absolute inset-0 z-10">
                            {loading ? (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-[#636363] text-sm font-semibold tracking-widest uppercase gap-4">
                                    <div className="w-12 h-12 border-4 border-[#EAEAEA] border-t-[#397554] rounded-full animate-spin" />
                                    Loading visual data...
                                </div>
                            ) : (
                                graphData.nodes.length > 0 && (
                                    <ForceGraph
                                        graphData={graphData}
                                        activeNodeId={activeNodeId}
                                        onNodeClick={(id: string) => setActiveNodeId(id)}
                                    />
                                )
                            )}
                        </div>

                        {/* Floating telemetry metrics block */}
                        {!loading && (
                            <div className="absolute top-6 left-6 z-20 flex gap-3 text-xs font-mono text-[#636363]">
                                <div className="bg-white/90 backdrop-blur-md px-3 py-2 rounded-md border border-[#EAEAEA] shadow-sm flex gap-2 items-center">
                                    <Database className="w-3.5 h-3.5 text-[#636363]" />
                                    <span>NODES</span> <span className="text-[#111111] font-bold ml-1">{graphData.nodes.length}</span>
                                </div>
                                <div className="bg-white/90 backdrop-blur-md px-3 py-2 rounded-md border border-[#EAEAEA] shadow-sm flex gap-2 items-center">
                                    <Network className="w-3.5 h-3.5 text-[#636363]" />
                                    <span>EDGES</span> <span className="text-[#111111] font-bold ml-1">{graphData.edges.length}</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {/* Right Sidebar - Node Properties */}
            <aside className="w-80 border-l border-[#EAEAEA] bg-white flex flex-col z-30 shrink-0">
                <div className="h-20 flex justify-between items-center px-6 border-b border-[#EAEAEA] shrink-0">
                    <h2 className="text-sm font-semibold text-[#111111] tracking-wide">Node Properties</h2>
                    {activeNode && (
                        <button onClick={() => setActiveNodeId(null)} className="cursor-pointer text-[#636363] hover:text-[#111111] transition-colors p-1.5 hover:bg-[#F2F2F2] rounded-md text-xs flex items-center gap-1">
                            <X className="w-3.5 h-3.5" /> Close
                        </button>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 relative">
                    {activeNode ? (
                        <>
                            {/* Visual Type Indicator */}
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2 bg-[#F9F9F9] px-2.5 py-1 rounded-md border border-[#EAEAEA]">
                                    <div className={`w-2 h-2 rounded-full ${activeNode.type === 'goal' ? 'bg-[#2F80ED]' :
                                        activeNode.type === 'decision' ? 'bg-[#397554]' :
                                            activeNode.type === 'constraint' ? 'bg-[#EB5757]' :
                                                'bg-[#9B51E0]'
                                        }`} />
                                    <span className="text-[10px] uppercase tracking-widest font-bold text-[#636363]">{activeNode.type}</span>
                                </div>
                                <span className="text-[10px] text-[#636363] font-mono tracking-widest bg-[#F9F9F9] border border-[#EAEAEA] px-2 py-1 rounded-sm">ID: {activeNode.id.split('-')[0]}</span>
                            </div>

                            {/* Content Edit */}
                            <div>
                                <label className="text-[10px] uppercase font-bold tracking-widest text-[#636363] mb-2 block">Content</label>
                                <textarea
                                    className="w-full h-40 bg-white border border-[#EAEAEA] text-[#111111] text-xs rounded-md p-3 focus:outline-none focus:border-[#111111] focus:ring-1 focus:ring-[#111111] transition-all resize-none leading-relaxed shadow-sm"
                                    value={editContent}
                                    onChange={(e) => setEditContent(e.target.value)}
                                />
                            </div>

                            {/* Tags Edit */}
                            <div>
                                <label className="text-[10px] uppercase font-bold tracking-widest text-[#636363] mb-2 block">Tags</label>
                                <input
                                    type="text"
                                    className="w-full bg-white border border-[#EAEAEA] text-[#111111] text-xs rounded-md px-3 py-2.5 focus:outline-none focus:border-[#111111] focus:ring-1 focus:ring-[#111111] transition-all shadow-sm"
                                    value={editTags}
                                    onChange={(e) => setEditTags(e.target.value)}
                                    placeholder="core, ui, network..."
                                />
                            </div>
                        </>
                    ) : (
                        <div className="absolute inset-0 flex flex-col gap-3 items-center justify-center text-[#636363] px-10 text-center">
                            <div className="w-12 h-12 rounded-full border border-[#EAEAEA] flex items-center justify-center bg-[#F9F9F9]">
                                <Crosshair className="w-5 h-5 text-[#A0A0A0]" />
                            </div>
                            <p className="text-xs font-medium">Select a node to view or edit its properties.</p>
                        </div>
                    )}
                </div>

                {/* Action Footer */}
                {activeNode && (
                    <div className="p-6 pt-0 shrink-0 flex gap-3">
                        <button
                            onClick={handleSave}
                            disabled={isSaving || (editContent === activeNode.content && editTags === (activeNode.tags || []).join(', '))}
                            className="cursor-pointer flex-1 flex items-center justify-center gap-2 bg-[#111111] text-white font-semibold text-[11px] uppercase tracking-wider py-2 rounded-md transition-colors disabled:bg-[#F2F2F2] disabled:text-[#A0A0A0] hover:bg-[#333333] disabled:cursor-not-allowed"
                        >
                            {isSaving ? 'Saving...' : 'Save Changes'}
                        </button>
                        <button
                            onClick={handleDeleteNode}
                            className="cursor-pointer px-4 py-2 rounded-md text-[#EB5757] bg-white border border-[#EAEAEA] hover:bg-[#FFF0F0] hover:border-[#FFD9D9] transition-colors text-[11px] uppercase tracking-wider font-semibold"
                        >
                            Delete
                        </button>
                    </div>
                )}
            </aside>
        </div>
    );
}
