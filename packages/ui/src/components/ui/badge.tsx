import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/ui';

export function Badge({
  className,
  muted = false,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { muted?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide',
        muted
          ? 'border-[var(--border-muted)] bg-[var(--surface-subtle)] text-[var(--text-muted)]'
          : 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]',
        className
      )}
      {...props}
    />
  );
}

