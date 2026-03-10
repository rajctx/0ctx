import type { ToolResponse } from './tool-dispatch-types';

export function textToolResult(text: string, isError = false): ToolResponse {
    return {
        _meta: {},
        toolResult: {
            content: [{ type: 'text', text }],
            ...(isError ? { isError: true } : {})
        }
    };
}

export function jsonToolResult(value: unknown): ToolResponse {
    return textToolResult(JSON.stringify(value, null, 2));
}
