import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useCheckpointDetail, useCheckpoints } from '../runtime/queries';
import { useShellStore } from '../../lib/store';
import { formatRelativeLabel, pickText, workstreamKey } from '../../lib/format';

export function CheckpointDrawer() {
  const {
    drawer,
    closeDrawer,
    activeContextId,
    activeWorkstreamKey,
    activeCheckpointId,
    setActiveCheckpointId
  } = useShellStore();

  const [branch, worktreePath] = (activeWorkstreamKey || '::').split('::');
  const checkpoints = useCheckpoints(
    activeContextId,
    branch || null,
    worktreePath || null,
    activeWorkstreamKey,
    { enabled: drawer === 'checkpoint' }
  );
  const detail = useCheckpointDetail(activeCheckpointId);
  const items = checkpoints.data ?? [];

  useEffect(() => {
    if (drawer !== 'checkpoint' || items.length === 0) {
      return;
    }

    if (!activeCheckpointId || !items.some((checkpoint) => checkpoint.checkpointId === activeCheckpointId)) {
      setActiveCheckpointId(items[0].checkpointId);
    }
  }, [activeCheckpointId, drawer, items, setActiveCheckpointId]);

  if (drawer !== 'checkpoint') {
    return null;
  }

  return (
    <div className="drawer-backdrop">
      <aside className="drawer-panel">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Checkpoint drawer</p>
            <h2 className="section-title">Checkpoint detail</h2>
          </div>
          <button className="icon-button" onClick={closeDrawer} aria-label="Close checkpoint drawer">
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="drawer-list">
            {items.length === 0 ? <p className="section-copy">No checkpoints are available.</p> : null}
            {items.map((checkpoint) => {
              const key = checkpoint.checkpointId;
              const active = key === activeCheckpointId;
              return (
                <button
                  type="button"
                  key={key}
                  className={active ? 'drawer-list-item active' : 'drawer-list-item'}
                  onClick={() => setActiveCheckpointId(key)}
                >
                  <span className="drawer-list-title">{pickText(checkpoint.summary, checkpoint.kind, checkpoint.checkpointId)}</span>
                  <span className="drawer-list-meta">{formatRelativeLabel(checkpoint.createdAt)}</span>
                  <span className="drawer-list-meta">{workstreamKey(checkpoint.branch, checkpoint.worktreePath)}</span>
                </button>
              );
            })}
          </div>

          <div className="panel-surface">
            <p className="eyebrow">Selected checkpoint</p>
            <h3 className="section-title">{pickText(detail.data?.checkpoint?.summary as string | null | undefined, activeCheckpointId)}</h3>
            <p className="section-copy">
              {pickText(
                typeof detail.data?.checkpoint?.summary === 'string' ? detail.data?.checkpoint?.summary : null,
                'Select a checkpoint to inspect stored metadata.'
              )}
            </p>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="metric-tile">
                <span className="metric-label">Session</span>
                <strong>{pickText(detail.data?.checkpoint?.sessionId as string | null | undefined, 'No linked session')}</strong>
              </div>
              <div className="metric-tile">
                <span className="metric-label">Kind</span>
                <strong>{pickText(detail.data?.checkpoint?.kind as string | null | undefined, 'Checkpoint')}</strong>
              </div>
            </div>

            <pre className="mt-5 overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-xs text-[var(--text-muted)]">
              {JSON.stringify(detail.data?.checkpoint ?? {}, null, 2)}
            </pre>
          </div>
        </div>
      </aside>
    </div>
  );
}
