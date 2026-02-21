'use server';
import { sendToDaemon } from '@/lib/0ctx';

export async function getContexts() {
    return await sendToDaemon('listContexts');
}

export async function getGraphData(contextId: string) {
    try {
        return await sendToDaemon('getGraphData', { contextId });
    } catch (e) {
        console.error("Failed to fetch graph data", e);
        return { nodes: [], edges: [] };
    }
}

export async function updateNodeData(id: string, updates: { content?: string, tags?: string[] }) {
    try {
        return await sendToDaemon('updateNode', { id, updates });
    } catch (e) {
        console.error("Failed to update node data", e);
        return null;
    }
}

export async function createContext(name: string, paths: string[] = []) {
    try {
        return await sendToDaemon('createContext', { name, paths });
    } catch (e) {
        console.error("Failed to create context", e);
        return null;
    }
}

export async function deleteContextAction(id: string) {
    try {
        return await sendToDaemon('deleteContext', { id });
    } catch (e) {
        console.error("Failed to delete context", e);
        return null;
    }
}

export async function deleteNodeAction(contextId: string, id: string) {
    try {
        // Need to pass contextId explicitly so daemon allows request
        return await sendToDaemon('deleteNode', { contextId, id });
    } catch (e) {
        console.error("Failed to delete node", e);
        return null;
    }
}
