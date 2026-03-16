import { describe, expect, it } from 'vitest';
import { getGaIntegrationCounts, getGaIntegrations } from '../../src/renderer/lib/setup-integrations';

describe('setup integrations', () => {
  it('normalizes the three GA integrations even when some are missing', () => {
    const integrations = getGaIntegrations({
      agents: [
        { agent: 'claude', installed: true, status: 'Supported' },
        { agent: 'factory', installed: false, status: 'Supported' }
      ]
    });

    expect(integrations.map((integration) => integration.id)).toEqual(['claude', 'factory', 'antigravity']);
    expect(integrations[2]).toMatchObject({
      id: 'antigravity',
      installed: false,
      status: 'Supported'
    });
  });

  it('reports ready counts from the visible GA integrations only', () => {
    const counts = getGaIntegrationCounts({
      readyCount: 9,
      agents: [
        { agent: 'claude', installed: true, status: 'Supported' },
        { agent: 'factory', installed: true, status: 'Supported' },
        { agent: 'antigravity', installed: false, status: 'Supported' },
        { agent: 'other-agent', installed: true, status: 'Supported' }
      ]
    });

    expect(counts.readyCount).toBe(2);
    expect(counts.totalCount).toBe(3);
  });
});
