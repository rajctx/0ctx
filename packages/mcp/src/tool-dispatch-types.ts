export interface ToolDispatchContext {
    callDaemon: (method: string, params?: Record<string, unknown>) => Promise<any>;
    pickContextId: (args: Record<string, unknown> | undefined) => string | undefined;
    switchSessionContext: (contextId: string) => Promise<void>;
}

export interface ToolResponse {
    _meta: Record<string, never>;
    toolResult: {
        content: Array<{ type: 'text'; text: string }>;
        isError?: boolean;
    };
}
