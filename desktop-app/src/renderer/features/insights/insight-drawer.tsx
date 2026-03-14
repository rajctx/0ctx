import { X } from 'lucide-react';
import { useInsights } from '../runtime/queries';
import { useShellStore } from '../../lib/store';
import { formatRelativeLabel, pickText } from '../../lib/format';

export function InsightDrawer() {
  const {
    drawer,
    closeDrawer,
    activeContextId,
    activeWorkstreamKey,
    activeInsightId,
    setActiveInsightId
  } = useShellStore();

  const [branch, worktreePath] = (activeWorkstreamKey || '::').split('::');
  const insights = useInsights(activeContextId, branch || null, worktreePath || null, activeWorkstreamKey);
  const selected = (insights.data ?? []).find((item) => item.nodeId === activeInsightId) ?? insights.data?.[0] ?? null;

  if (drawer !== 'insight') {
    return null;
  }

  return (
    <div className="drawer-backdrop">
      <aside className="drawer-panel">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Insight drawer</p>
            <h2 className="section-title">Insight detail</h2>
          </div>
          <button className="icon-button" onClick={closeDrawer} aria-label="Close insight drawer">
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="drawer-list">
            {(insights.data ?? []).length === 0 ? <p className="section-copy">No reviewed insights are available.</p> : null}
            {(insights.data ?? []).map((insight) => {
              const active = insight.nodeId === activeInsightId;
              return (
                <button
                  type="button"
                  key={insight.nodeId}
                  className={active ? 'drawer-list-item active' : 'drawer-list-item'}
                  onClick={() => setActiveInsightId(insight.nodeId)}
                >
                  <span className="drawer-list-title">{pickText(insight.title, insight.key, insight.nodeId)}</span>
                  <span className="drawer-list-meta">{pickText(insight.type, 'artifact')}</span>
                  <span className="drawer-list-meta">{formatRelativeLabel(insight.createdAt)}</span>
                </button>
              );
            })}
          </div>

          <div className="panel-surface">
            <p className="eyebrow">Selected insight</p>
            <h3 className="section-title">{pickText(selected?.title, selected?.key, 'Choose an insight')}</h3>
            <p className="section-copy">{pickText(selected?.content, 'Select an insight to inspect reviewed memory and provenance.')}</p>
            <div className="mt-5 metric-tile">
              <span className="metric-label">Node id</span>
              <strong>{pickText(selected?.nodeId, 'No node selected')}</strong>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
