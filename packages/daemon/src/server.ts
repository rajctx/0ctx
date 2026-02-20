import net from 'net';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { openDb, Graph } from '@0ctx/core';
import { getActiveContext, setActiveContext, clearContext } from './resolver';

const IS_WIN = os.platform() === 'win32';
const SOCKET_PATH = IS_WIN ? '\\\\.\\pipe\\0ctx.sock' : path.join(os.homedir(), '.0ctx', '0ctx.sock');

export function startDaemon() {
    // Unix specifically throws EACCES if the domain socket file already exists from a prior run.
    if (!IS_WIN && fs.existsSync(SOCKET_PATH)) {
        try {
            fs.unlinkSync(SOCKET_PATH);
        } catch (e) {
            console.error('Failed to cleanup old socket file', e);
        }
    }

    const db = openDb();
    const graph = new Graph(db);

    const server = net.createServer(socket => {
        // Unique ID for this client connection to track active context
        const connectionId = randomUUID();

        let buffer = '';
        socket.on('data', data => {
            buffer += data.toString();
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const message = buffer.slice(0, newlineIndex);
                buffer = buffer.slice(newlineIndex + 1);

                try {
                    const req = JSON.parse(message);
                    const result = handleRequest(graph, connectionId, req);
                    socket.write(JSON.stringify({ ok: true, result }) + '\n');
                } catch (err: any) {
                    socket.write(JSON.stringify({ ok: false, error: err.message }) + '\n');
                }
            }
        });

        socket.on('close', () => {
            clearContext(connectionId);
        });
    });

    server.listen(SOCKET_PATH, () => {
        console.log(`0ctx daemon running at ${SOCKET_PATH}`);
    });

    process.on('SIGINT', () => { server.close(); process.exit(); });
    process.on('SIGTERM', () => { server.close(); process.exit(); });
}

function handleRequest(graph: Graph, connectionId: string, req: any): any {
    // Context Management
    if (req.method === 'listContexts') {
        return graph.listContexts();
    }
    if (req.method === 'createContext') {
        const ctx = graph.createContext(req.params.name, req.params.paths || []);
        setActiveContext(connectionId, ctx.id);
        return ctx;
    }
    if (req.method === 'deleteContext') {
        graph.deleteContext(req.params.id);
        const activeId = getActiveContext(connectionId);
        if (activeId === req.params.id) {
            clearContext(connectionId);
        }
        return { success: true };
    }
    if (req.method === 'switchContext') {
        const ctx = graph.getContext(req.params.contextId);
        if (!ctx) throw new Error(`Context ${req.params.contextId} not found`);
        setActiveContext(connectionId, ctx.id);
        return ctx;
    }
    if (req.method === 'getActiveContext') {
        const ctxId = getActiveContext(connectionId);
        return ctxId ? graph.getContext(ctxId) : null;
    }

    // Node operations require an active context (either from sticky session or payload)
    const contextId = getActiveContext(connectionId) || (req.params && req.params.contextId);
    if (!contextId && ['addNode', 'getByKey', 'search', 'getGraphData', 'saveCheckpoint', 'listCheckpoints'].includes(req.method)) {
        throw new Error("No active context set! Call 'switchContext' or 'createContext' first, or provide contextId in params.");
    }

    switch (req.method) {
        case 'addNode': return graph.addNode({ ...req.params, contextId: contextId! });
        case 'getNode': return graph.getNode(req.params.id);
        case 'updateNode': return graph.updateNode(req.params.id, req.params.updates);
        case 'getByKey': return graph.getByKey(contextId!, req.params.key);
        case 'deleteNode': return graph.deleteNode(req.params.id);
        case 'addEdge': return graph.addEdge(req.params.fromId, req.params.toId, req.params.relation);
        case 'getSubgraph': return graph.getSubgraph(req.params.rootId, req.params.depth, req.params.maxNodes);
        case 'search': return graph.search(contextId!, req.params.query, req.params.limit);
        case 'getGraphData': return graph.getGraphData(contextId!);
        case 'saveCheckpoint': return graph.saveCheckpoint(contextId!, req.params.name);
        case 'rewind': return graph.rewind(req.params.checkpointId);
        case 'listCheckpoints': return graph.listCheckpoints(contextId!);
        default: throw new Error(`Unknown method: ${req.method}`);
    }
}
