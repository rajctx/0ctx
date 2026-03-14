import type { PropsWithChildren, ReactNode } from 'react';
import { cn } from '../../lib/format';

interface SurfaceProps extends PropsWithChildren {
  eyebrow?: string;
  title?: string;
  copy?: string;
  actions?: ReactNode;
  className?: string;
}

export function Surface({ eyebrow, title, copy, actions, className, children }: SurfaceProps) {
  return (
    <section className={cn('panel-surface', className)}>
      {(eyebrow || title || actions) && (
        <div className="flex items-start justify-between gap-4">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            {title ? <h2 className="section-title">{title}</h2> : null}
            {copy ? <p className="section-copy">{copy}</p> : null}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

interface StatTileProps {
  label: string;
  value: string;
  accent?: string;
}

export function StatTile({ label, value, accent }: StatTileProps) {
  return (
    <div className="metric-tile">
      <span className="metric-label">{label}</span>
      <strong className={accent}>{value}</strong>
    </div>
  );
}
