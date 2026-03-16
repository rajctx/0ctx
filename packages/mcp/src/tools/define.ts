import type { McpToolDefinition } from './types';

export function defineTool(
    name: string,
    description: string,
    properties: Record<string, unknown> = {},
    required: string[] = []
): McpToolDefinition {
    return {
        name,
        description,
        inputSchema: {
            type: 'object',
            properties,
            required
        }
    };
}
