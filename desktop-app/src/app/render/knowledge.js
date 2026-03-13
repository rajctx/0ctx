(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state, activeContext, activeInsightNode, syncInsightSelection, insightSummary, insightTargetContexts, syncPromotionTargetSelection, contextById, methodSupported, matches, esc, formatTime, basenameFromPath, humanizeLabel, short } = app;

  function factStripItem(label, value) {
    return `<article><span>${esc(label)}</span><strong>${esc(value || '-')}</strong></article>`;
  }

  function setText(selector, text) {
    if (typeof document?.querySelector !== 'function') {
      return;
    }
    const element = document.querySelector(selector);
    if (element) {
      element.textContent = text;
    }
  }

  function applyKnowledgeCopy() {
    setText('section[data-view="knowledge"] .page-kicker', 'Reviewed memory');
  }

  function renderKnowledge() {
      applyKnowledgeCopy();
      document.getElementById('inclHidden').checked = state.includeHidden;
      const nodes = state.insights.filter((node) =>
        matches(`${node.type || ''} ${node.content || ''} ${node.key || ''} ${node.trustSummary || ''} ${Array.isArray(node.corroboratedRoles) ? node.corroboratedRoles.join(' ') : ''}`)
      );
      const selectedNode = syncInsightSelection(nodes);
      const selectedInsight = insightSummary(selectedNode);
      const targetContexts = insightTargetContexts();
      const selectedTargetContext = syncPromotionTargetSelection();
      const promoteSupported = methodSupported('promoteInsight');
      const knowledgePageMeta = document.getElementById('knowledgePageMeta');
      const knowledgeSummaryLine = document.getElementById('knowledgeSummaryLine');
      if (knowledgePageMeta) {
        const context = activeContext();
        knowledgePageMeta.textContent = context
          ? `${context.name} has ${nodes.length} reviewed insight${nodes.length === 1 ? '' : 's'} in the current view.`
          : 'Use this page for reviewed memory. Raw conversation stays in Sessions.';
      }
      if (knowledgeSummaryLine) {
        const context = activeContext();
        const bits = [
          `${nodes.length} reviewed insight${nodes.length === 1 ? '' : 's'}`,
          `${state.graphEdges.length} graph edge${state.graphEdges.length === 1 ? '' : 's'}`,
          context ? `Workspace: ${context.name}` : 'No workspace selected'
        ];
        knowledgeSummaryLine.textContent = bits.join(' · ');
      }

      document.getElementById('knowledgeExplainer').textContent = 'Keep only durable memory here.';

      const selectedInsightEmpty = document.getElementById('selectedInsightEmpty');
      const selectedInsightBody = document.getElementById('selectedInsightBody');
      if (!selectedNode) {
        selectedInsightEmpty.classList.remove('hidden');
        selectedInsightBody.classList.add('hidden');
        document.getElementById('selectedInsightTitle').textContent = 'Choose an insight';
        document.getElementById('selectedInsightLeadCopy').textContent = '';
        document.getElementById('selectedInsightCopy').textContent = '';
        document.getElementById('selectedInsightFactStrip').innerHTML = '';
        document.getElementById('selectedInsightMeta').innerHTML = '';
      } else {
        selectedInsightEmpty.classList.add('hidden');
        selectedInsightBody.classList.remove('hidden');
        document.getElementById('selectedInsightTitle').textContent = selectedInsight.title;
        document.getElementById('selectedInsightLeadCopy').textContent = [
          `${humanizeLabel(selectedInsight.trustTier)} trust across ${selectedInsight.distinctEvidenceCount || selectedInsight.evidenceCount || 0} evidence point${(selectedInsight.distinctEvidenceCount || selectedInsight.evidenceCount || 0) === 1 ? '' : 's'}.`,
          selectedInsight.promotionState === 'ready'
            ? 'Ready to promote if this memory should carry into another project.'
          : selectedInsight.promotionState === 'review'
              ? 'Review it before moving it across workspaces.'
              : 'Promotion is blocked until trust concerns are resolved.'
        ].join(' ');
        document.getElementById('selectedInsightFactStrip').innerHTML = [
          factStripItem('Trust', humanizeLabel(selectedInsight.trustTier)),
          factStripItem('Promotion', humanizeLabel(selectedInsight.promotionState || 'review')),
          factStripItem('Evidence', `${selectedInsight.distinctEvidenceCount || selectedInsight.evidenceCount || 0}`)
        ].join('');
        const meta = [
          { label: 'Type', value: humanizeLabel(selectedInsight.type) },
          { label: 'Source', value: selectedInsight.source },
          selectedInsight.latestEvidenceAt ? { label: 'Latest evidence', value: formatTime(selectedInsight.latestEvidenceAt) } : null
        ];
        document.getElementById('selectedInsightMeta').innerHTML = meta
          .filter(Boolean)
          .map((item) => `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`)
          .join('');
        const selectedInsightCopy = document.getElementById('selectedInsightCopy');
        selectedInsightCopy.innerHTML = `
          <p class="detail-copy detail-primary">${esc(selectedInsight.summary)}</p>
        `;
        if (selectedInsight.trustSummary) {
          selectedInsightCopy.insertAdjacentHTML('beforeend', `<p class="detail-copy detail-muted">${esc(selectedInsight.trustSummary)}</p>`);
        }
        const supportNotes = [
          selectedInsight.branch ? `Workstream: ${selectedInsight.branch}` : '',
          selectedInsight.worktreePath ? `Worktree: ${basenameFromPath(selectedInsight.worktreePath)}` : '',
          selectedInsight.trustFlags.length > 0 ? `Trust flags: ${selectedInsight.trustFlags.map((flag) => humanizeLabel(flag)).join(', ')}` : ''
        ].filter(Boolean);
        if (supportNotes.length > 0) {
          selectedInsightCopy.insertAdjacentHTML('beforeend', `<p class="detail-copy detail-muted">${esc(supportNotes.join(' · '))}</p>`);
        }
        if (selectedInsight.evidencePreview.length > 0) {
          selectedInsightCopy.insertAdjacentHTML('beforeend', `
            <div class="preview-footnote">
              <strong>Evidence preview</strong>
              <ul class="evidence-list">
                ${selectedInsight.evidencePreview.map((excerpt) => `<li>${esc(excerpt)}</li>`).join('')}
              </ul>
            </div>
          `);
        }
      }

      const targetSelect = document.getElementById('insightTargetContext');
      targetSelect.innerHTML = targetContexts.length > 0
        ? targetContexts.map((context) => `
            <option value="${esc(context.id)}" ${context.id === state.promotionTargetContextId ? 'selected' : ''}>
              ${esc(context.name || context.id)}
            </option>
          `).join('')
        : '<option value="">No other workspaces</option>';
      targetSelect.disabled = targetContexts.length === 0;

      const promoteButton = document.getElementById('promoteInsightBtn');
      promoteButton.disabled = !promoteSupported || !selectedNode || !selectedTargetContext || selectedInsight.promotionState === 'blocked';

      const promotionCopy = document.getElementById('insightPromotionCopy');
      if (!promoteSupported) {
        promotionCopy.textContent = 'Update the local runtime to promote reviewed insights across workspaces.';
      } else if (!selectedNode) {
        promotionCopy.textContent = 'Select an insight first. Promotion is always explicit.';
      } else if (selectedInsight.promotionState === 'blocked') {
        promotionCopy.textContent = selectedInsight.promotionSummary || 'This insight is not ready to promote yet.';
      } else if (!selectedTargetContext) {
        promotionCopy.textContent = 'Create another workspace before promoting reviewed insights across projects.';
      } else {
        promotionCopy.textContent = selectedInsight.promotionState === 'review'
          ? `This insight can move into ${selectedTargetContext.name}, but it still needs human review first.`
          : `Promote this reviewed insight into ${selectedTargetContext.name}. Provenance stays attached.`;
      }

      const promotionMeta = [];
      if (selectedTargetContext) {
        promotionMeta.push({ title: 'Target workspace', detail: selectedTargetContext.name });
      }
      if (selectedInsight.branch) {
        promotionMeta.push({ title: 'Target workstream tag', detail: selectedInsight.branch });
      }
      const promotion = state.lastInsightPromotion;
      if (promotion && promotion.sourceNodeId === (selectedNode?.nodeId || selectedNode?.id)) {
        promotionMeta.push({
          title: promotion.created ? 'Last promotion' : 'Last promotion reused',
          detail: `${contextById(promotion.targetContextId)?.name || promotion.targetContextId} · ${short(promotion.targetNodeId || 'target node', 18)}`
        });
      }
      document.getElementById('insightPromotionMeta').innerHTML = promotionMeta.length > 0
        ? promotionMeta.map((item) => `<article><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></article>`).join('')
        : '<article><strong>Promotion is explicit</strong><p>Promote only reviewed memory another workspace should inherit.</p></article>';

      document.getElementById('knowledgeTable').innerHTML = nodes.length > 0
        ? nodes.slice(0, 400).map((node) => {
            const nodeKey = node.nodeId || node.id;
            const active = nodeKey === state.activeInsightNodeId ? ' active' : '';
            const summary = insightSummary(node);
            const summaryMeta = [
              humanizeLabel(summary.type),
              summary.branch ? `Workstream ${summary.branch}` : null,
              summary.originContextId ? 'Promoted insight' : null,
              summary.latestEvidenceAt ? formatTime(summary.latestEvidenceAt) : null
            ].filter(Boolean).join(' · ');
            const trustMeta = [
              `${humanizeLabel(summary.trustTier)} trust`,
              `${summary.distinctEvidenceCount || summary.evidenceCount || 0} evidence`,
              summary.distinctSessionCount > 1 ? `${summary.distinctSessionCount} sessions` : null,
              summary.promotionState ? `${humanizeLabel(summary.promotionState)} promotion` : null
            ].filter(Boolean).join(' · ');
            return `
              <article class="list-item insight-row${active}" data-insight-id="${esc(nodeKey)}">
                <div class="insight-row-head">
                  <div>
                    <h4 class="item-title">${esc(short(summary.title, 88))}</h4>
                    ${summaryMeta ? `<p class="item-meta-line">${esc(summaryMeta)}</p>` : ''}
                  </div>
                </div>
                ${summary.summary ? `<p class="item-preview">${esc(short(summary.summary, 180))}</p>` : ''}
                ${trustMeta ? `<p class="item-meta-line">${esc(trustMeta)}</p>` : ''}
              </article>
            `;
          }).join('')
        : '<div class="empty-state">No reviewed insights match the current filter.</div>';
  }

  Object.assign(app, { applyKnowledgeCopy, renderKnowledge });
})();
