import type { HookHealth } from '../../shared/types/domain';

const GA_AGENT_IDS = ['claude', 'factory', 'antigravity'] as const;

type HookAgent = NonNullable<HookHealth['agents']>[number];

export interface SetupIntegration {
  id: string;
  label: string;
  status: HookAgent['status'];
  installed: boolean;
  notes: string | null;
}

function toTitleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function getGaIntegrations(hookHealth?: HookHealth | null): SetupIntegration[] {
  const agents = new Map<string, HookAgent>();

  for (const agent of hookHealth?.agents ?? []) {
    const id = String(agent.agent ?? '').trim().toLowerCase();
    if (id) {
      agents.set(id, agent);
    }
  }

  return GA_AGENT_IDS.map((id) => {
    const agent = agents.get(id);
    return {
      id,
      label: toTitleCase(id),
      status: agent?.status ?? 'Supported',
      installed: Boolean(agent?.installed),
      notes: agent?.notes ?? null
    } satisfies SetupIntegration;
  });
}

export function getGaIntegrationCounts(hookHealth?: HookHealth | null) {
  const integrations = getGaIntegrations(hookHealth);
  return {
    integrations,
    readyCount: integrations.filter((integration) => integration.installed).length,
    totalCount: integrations.length
  };
}

