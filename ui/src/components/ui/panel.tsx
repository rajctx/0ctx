import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/ui';

export function Panel({
  className,
  glass = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { glass?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-[var(--border-muted)] bg-[var(--surface-base)] shadow-[var(--shadow-soft)]',
        glass ? 'bg-[var(--surface-glass)] backdrop-blur-xl' : '',
        className
      )}
      {...props}
    />
  );
}

