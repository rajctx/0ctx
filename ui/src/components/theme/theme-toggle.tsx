'use client';

import { Laptop2, MoonStar, SunMedium } from 'lucide-react';
import { useTheme } from '@/components/theme/theme-provider';
import { cn } from '@/lib/ui';

const OPTIONS = [
  { mode: 'system', label: 'System', icon: Laptop2 },
  { mode: 'light', label: 'Light', icon: SunMedium },
  { mode: 'dark', label: 'Dark', icon: MoonStar }
] as const;

export function ThemeToggle({
  compact = false,
  className
}: {
  compact?: boolean;
  className?: string;
}) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border border-[var(--border-muted)] bg-[var(--surface-glass)] p-1 shadow-[var(--shadow-soft)] backdrop-blur-md',
        className
      )}
      role="radiogroup"
      aria-label="Theme mode"
    >
      {OPTIONS.map(option => {
        const Icon = option.icon;
        const isActive = theme === option.mode;
        return (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => setTheme(option.mode)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors',
              compact ? 'w-8 h-8 p-0' : '',
              isActive
                ? 'bg-[var(--surface-raised)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            )}
            title={option.label}
          >
            <Icon className="h-3.5 w-3.5" />
            {!compact && <span>{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

