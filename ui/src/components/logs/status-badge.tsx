'use client';

type BadgeVariant = 'connected' | 'offline' | 'degraded' | 'pending' | 'applied' | 'failed' | 'verified' | 'unverified';

interface StatusBadgeProps {
  variant: BadgeVariant;
  label?: string;
}

export function StatusBadge({ variant, label }: StatusBadgeProps) {
  const text = label ?? variant;
  return (
    <span className={`l-badge ${variant}`}>
      {text.toUpperCase()}
    </span>
  );
}
