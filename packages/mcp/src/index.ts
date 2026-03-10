import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { sendToDaemon } from './client';
import { handleCoreToolCall } from './dispatch-core';
import { handleKnowledgeToolCall } from './dispatch-knowledge';
import { handleOpsToolCall } from './dispatch-ops';
import { handleRecallToolCall } from './dispatch-recall';
import { handleWorkstreamToolCall } from './dispatch-workstream';
import { resolveInitialSessionContextId } from './session-context';
import type { ToolDispatchContext } from './tool-dispatch-types';
import { textToolResult } from './tool-results';
import { getToolsForProfile, isToolEnabledForProfile, resolveMcpToolProfile } from './tools';

const server = new Server(
    { name: '0ctx', version: '0.1.0' },
    { capabilities: { tools: {} } }
);

function parseArgValue(flag: string): string | null {
    const direct = process.argv.find(arg => arg.startsWith(`${flag}=`));
    if (direct) return direct.slice(flag.length + 1);

    const index = process.argv.findIndex(arg => arg === flag);
    if (index !== -1 && process.argv[index + 1]) {
        return process.argv[index + 1];
    }

    return null;
}

const requestedToolProfile =
    parseArgValue('--profile')
    ?? parseArgValue('--mcp-profile')
    ?? process.env.CTX_MCP_PROFILE
    ?? 'all';
const resolvedToolProfile = resolveMcpToolProfile(requestedToolProfile);
const activeTools = getToolsForProfile(resolvedToolProfile);

if (resolvedToolProfile.invalidTokens.length > 0) {
    console.error(`[0ctx-mcp] Ignoring invalid profile tokens: ${resolvedToolProfile.invalidTokens.join(', ')}`);
}
if (!resolvedToolProfile.all) {
    console.error(
        `[0ctx-mcp] Tool profile active: ${resolvedToolProfile.normalized} (${activeTools.length}/${getToolsForProfile('all').length} tools)`
    );
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: activeTools }));

let sessionToken: string | null = null;

async function ensureSession(): Promise<string> {
    if (sessionToken) return sessionToken;

    const initialContextId = await resolveInitialSessionContextId();
    const session = await sendToDaemon('createSession', initialContextId ? { contextId: initialContextId } : {});
    if (typeof session.sessionToken !== 'string' || session.sessionToken.length === 0) {
        throw new Error('Daemon returned an invalid session token.');
    }

    sessionToken = session.sessionToken;
    return session.sessionToken;
}

async function callDaemon(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const token = await ensureSession();
    return sendToDaemon(method, params, { sessionToken: token });
}

function pickContextId(args: Record<string, unknown> | undefined): string | undefined {
    return typeof args?.contextId === 'string' && args.contextId.length > 0 ? args.contextId : undefined;
}

const dispatchContext: ToolDispatchContext = {
    callDaemon,
    pickContextId,
    switchSessionContext: async (contextId: string) => {
        await callDaemon('switchContext', { contextId });
    }
};

server.setRequestHandler(CallToolRequestSchema, async (req: any) => {
    const { name, arguments: rawArgs } = req.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;

    if (!isToolEnabledForProfile(name, resolvedToolProfile)) {
        return textToolResult(`Error: Tool '${name}' is disabled by MCP profile '${resolvedToolProfile.normalized}'.`, true);
    }

    try {
        const handlers = [
            handleCoreToolCall,
            handleWorkstreamToolCall,
            handleKnowledgeToolCall,
            handleRecallToolCall,
            handleOpsToolCall
        ];

        for (const handler of handlers) {
            const result = await handler(name, args, dispatchContext);
            if (result) return result;
        }

        throw new Error(`Unknown tool: ${name}`);
    } catch (error: any) {
        const message = String(error?.message ?? error);
        if (
            message.includes('Unknown method: recall')
            || message.includes('Unknown method: recallTopic')
            || message.includes('Unknown method: recallTemporal')
            || message.includes('Unknown method: recallGraph')
            || message.includes('Unknown method: recallFeedback')
        ) {
            return textToolResult(
                'Error: Connected daemon does not support recall APIs yet. Restart/update daemon (or connector service) and retry.',
                true
            );
        }
        return textToolResult(`Error: ${message}. Ensure this repo is enabled for 0ctx or provide contextId explicitly.`, true);
    }
});

const transport = new StdioServerTransport();
server.connect(transport);
