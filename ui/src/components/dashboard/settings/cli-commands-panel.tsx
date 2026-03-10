import { Terminal } from 'lucide-react';
import { Panel } from '@/components/ui/panel';

function CliLine({ cmd, comment }: { cmd: string; comment: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className="text-[var(--accent-text)]">{cmd}</span>
      <span className="text-[var(--text-muted)]">{comment}</span>
    </div>
  );
}

export function CliCommandsPanel() {
  return (
    <Panel className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <Terminal className="h-4 w-4 text-[var(--text-muted)]" />
        <p className="text-sm font-semibold text-[var(--text-primary)]">CLI Commands</p>
      </div>
      <div className="space-y-2 rounded-xl bg-[var(--surface-subtle)] p-4 font-mono text-sm">
        <CliLine cmd="0ctx auth login" comment="# device-code login flow" />
        <CliLine cmd="0ctx setup --validate --json" comment="# preflight runtime validation" />
        <CliLine cmd="0ctx auth status --json" comment="# machine-readable auth state" />
        <CliLine cmd="0ctx sync policy get --context-id=<id>" comment="# inspect policy" />
        <CliLine cmd="0ctx sync policy set metadata_only --context-id=<id>" comment="# update policy" />
        <CliLine cmd="0ctx connector status --cloud --json" comment="# connector posture" />
        <CliLine cmd="0ctx recall feedback list --json --limit=20" comment="# ranking feedback summary" />
      </div>
    </Panel>
  );
}
