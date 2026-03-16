export type ToolScope = 'core' | 'recall' | 'ops';
export type McpToolProfile = 'all' | ToolScope;

export interface McpToolDefinition {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required: string[];
    };
}

export interface ResolvedMcpToolProfile {
    requested: string;
    all: boolean;
    profiles: ToolScope[];
    scopes: ToolScope[];
    normalized: string;
    invalidTokens: string[];
}
