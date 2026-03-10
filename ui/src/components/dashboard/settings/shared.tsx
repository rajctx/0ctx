import { Panel } from '@/components/ui/panel';

export type ReadinessStep = {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
};

export function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <span className={`text-sm font-medium text-[var(--text-primary)] ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

export function SubtlePanel({ children }: { children: React.ReactNode }) {
  return <Panel className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--text-muted)]">{children}</Panel>;
}
