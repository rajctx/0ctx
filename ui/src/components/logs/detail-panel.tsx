'use client';

import { useEffect } from 'react';

export interface DetailPanelItem {
  label: string;
  value: string | number | null | undefined;
  accent?: boolean;
  accentColor?: string;
}

interface DetailPanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  accentColor?: string;
  metadata: DetailPanelItem[];
  payload?: string;
  children?: React.ReactNode;
}

export function DetailPanel({
  open,
  onClose,
  title,
  subtitle,
  accentColor = 'var(--l-gray)',
  metadata,
  payload,
  children,
}: DetailPanelProps) {
  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <>
      <div className={`l-overlay${open ? ' open' : ''}`} onClick={onClose} />
      <div className={`l-detail-panel${open ? ' open' : ''}`}>
        <div className="l-detail-accent" style={{ background: accentColor }} />
        <div className="l-detail-header">
          <div>
            <div className="l-detail-type" style={{ color: accentColor }}>{title}</div>
            {subtitle && <div className="l-detail-sub">{subtitle}</div>}
          </div>
          <button className="l-detail-close" onClick={onClose}>[ESC]</button>
        </div>
        <div className="l-detail-body">
          <div className="l-detail-section">
            <div className="l-detail-section-label">Metadata</div>
            {metadata.map((item, i) => (
              <div key={i} className="l-detail-kv">
                <span className="l-detail-kv-key">{item.label}</span>
                <span
                  className="l-detail-kv-val"
                  style={item.accentColor ? { color: item.accentColor } : undefined}
                >
                  {item.value ?? '--'}
                </span>
              </div>
            ))}
          </div>

          {payload !== undefined && (
            <div className="l-detail-section">
              <div className="l-detail-section-label">Payload</div>
              <pre className="l-payload">{payload}</pre>
            </div>
          )}

          {children}
        </div>
      </div>
    </>
  );
}
