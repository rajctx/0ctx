import { describe, expect, it } from 'vitest';
import { getLogsHtml } from '../src/logs-ui';

describe('getLogsHtml', () => {
    it('renders the logs shell with the requested port and core views', () => {
        const html = getLogsHtml(4312);
        expect(html).toContain('PORT: 4312');
        expect(html).toContain("const PORT = 4312;");
        expect(html).toContain("switchView('activity')");
        expect(html).toContain("switchView('daemon')");
        expect(html).toContain("api('/api/ops')");
        expect(html).toContain("api('/api/daemon')");
    });
});
