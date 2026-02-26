import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/ui';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variantClass: Record<Variant, string> = {
  primary:
    'bg-[var(--accent-strong)] text-[var(--accent-contrast)] border border-[var(--accent-strong)] hover:bg-[var(--accent-strong-hover)]',
  secondary:
    'bg-[var(--surface-raised)] text-[var(--text-primary)] border border-[var(--border-muted)] hover:border-[var(--border-strong)]',
  ghost:
    'bg-transparent text-[var(--text-muted)] border border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]',
  danger:
    'bg-[var(--danger-bg)] text-[var(--danger-fg)] border border-[var(--danger-border)] hover:bg-[var(--danger-bg-hover)]'
};

const sizeClass: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-sm'
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50',
        variantClass[variant],
        sizeClass[size],
        className
      )}
      {...props}
    />
  );
}

