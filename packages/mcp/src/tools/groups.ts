import { blackboardTools } from './blackboard';
import { graphTools } from './graph';
import { insightTools } from './insights';
import { recallTools } from './recall';
import { runtimeTools } from './runtime';
import type { McpToolDefinition, ToolScope } from './types';
import { workstreamTools } from './workstreams';

export const tools: McpToolDefinition[] = [
    ...graphTools,
    ...workstreamTools,
    ...insightTools,
    ...recallTools,
    ...runtimeTools,
    ...blackboardTools
];

function scopeEntries(scope: ToolScope, definitions: McpToolDefinition[]): Array<[string, ToolScope]> {
    return definitions.map(tool => [tool.name, scope]);
}

export const TOOL_SCOPE_BY_NAME: Record<string, ToolScope> = Object.fromEntries([
    ...scopeEntries('core', [...graphTools, ...workstreamTools, ...insightTools]),
    ...scopeEntries('recall', recallTools),
    ...scopeEntries('ops', [...runtimeTools, ...blackboardTools])
]);
