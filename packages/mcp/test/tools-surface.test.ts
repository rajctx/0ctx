import { describe, expect, it } from 'vitest';
import { getToolsForProfile } from '../src/tools';

describe('MCP tool surface', () => {
    it('keeps a unique tool name for every exported tool', () => {
        const tools = getToolsForProfile('all');
        const names = tools.map(tool => tool.name);

        expect(new Set(names).size).toBe(names.length);
    });

    it('keeps core, recall, and ops tool groups in the exported surface', () => {
        const names = new Set(getToolsForProfile('all').map(tool => tool.name));

        expect(names.has('ctx_get_workstream_brief')).toBe(true);
        expect(names.has('ctx_recall')).toBe(true);
        expect(names.has('ctx_blackboard_subscribe')).toBe(true);
    });
});
