(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state, activeContext, activeInsightNode, syncInsightSelection, insightSummary, insightTargetContexts, syncPromotionTargetSelection, contextById, methodSupported, matches, esc, formatTime, renderChip, basenameFromPath, humanizeLabel, short } = app;

  function renderKnowledge() {
      document.getElementById('inclHidden').checked = state.includeHidden;
      document.getElementById('knowledgeNodeCount').textContent = String(state.graphNodes.length);
      document.getElementById('knowledgeEdgeCount').textContent = String(state.graphEdges.length);
      document.getElementById('knowledgeContext').textContent = `Workspace: ${activeContext()?.name || 'none'}`;
      const nodes = state.graphNodes.filter((node) => matches(`${node.type || ''} ${node.content || ''} ${node.key || ''}`));
      const selectedNode = syncInsightSelection(nodes);
      const selectedInsight = insightSummary(selectedNode);
      const targetContexts = insightTargetContexts();
      const selectedTargetContext = syncPromotionTargetSelection();
      const promoteSupported = methodSupported('promoteInsight');
      const knowledgePageMeta = document.getElementById('knowledgePageMeta');
      if (knowledgePageMeta) {
        const context = activeContext();
        knowledgePageMeta.textContent = context
          ? `${context.name} currently exposes ${nodes.length} visible node${nodes.length === 1 ? '' : 's'} in the structured graph${state.includeHidden ? ', including hidden capture records.' : ', plus reviewed insights.'}`
          : 'Inspect the visible graph and reviewed insights stored in SQLite when you need durable project memory, not the raw conversation.';
      }

      const explainer = [
        {
          title: 'Use this for reviewed memory',
          detail: 'Insights are the durable structured layer: decisions, constraints, goals, assumptions, questions, and artifacts already written into the workspace.'
        },
        {
          title: 'Conversations stay separate by default',
          detail: 'Captured sessions and messages live in the same workspace, but stay hidden here unless you explicitly include hidden capture records.'
        },
        {
          title: 'Sessions and checkpoints feed this layer',
          detail: 'Use Sessions to read the conversation and Checkpoints to explain or rewind workspace state. Use Insights to inspect the memory that survives beyond a single run.'
        }
      ];
      document.getElementById('knowledgeExplainer').innerHTML = explainer.map((item) => {
        return `<article><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></article>`;
      }).join('');

      const selectedInsightEmpty = document.getElementById('selectedInsightEmpty');
      const selectedInsightBody = document.getElementById('selectedInsightBody');
      if (!selectedNode) {
        selectedInsightEmpty.classList.remove('hidden');
        selectedInsightBody.classList.add('hidden');
        document.getElementById('selectedInsightTitle').textContent = 'Choose an insight';
        document.getElementById('selectedInsightCopy').textContent = '';
        document.getElementById('selectedInsightMeta').innerHTML = '';
      } else {
        selectedInsightEmpty.classList.add('hidden');
        selectedInsightBody.classList.remove('hidden');
        document.getElementById('selectedInsightTitle').textContent = selectedInsight.title;
        document.getElementById('selectedInsightCopy').textContent = selectedInsight.summary;
        const meta = [
          { label: 'Type', value: humanizeLabel(selectedInsight.type) },
          { label: 'Source', value: selectedInsight.source },
          { label: 'Created', value: formatTime(selectedInsight.createdAt) },
          { label: 'Key', value: selectedInsight.key || 'none' },
          { label: 'Branch', value: selectedInsight.branch || 'none' },
          { label: 'Worktree', value: selectedInsight.worktreePath ? basenameFromPath(selectedInsight.worktreePath) : 'none' },
          { label: 'Origin workspace', value: contextById(selectedInsight.originContextId)?.name || selectedInsight.originContextId || 'current workspace' },
          { label: 'Origin node', value: selectedInsight.originNodeId || 'local insight' }
        ];
        document.getElementById('selectedInsightMeta').innerHTML = meta
          .map((item) => `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`)
          .join('');
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
      promoteButton.disabled = !promoteSupported || !selectedNode || !selectedTargetContext;

      const promotionCopy = document.getElementById('insightPromotionCopy');
      if (!promoteSupported) {
        promotionCopy.textContent = 'Update the local runtime to promote reviewed insights across workspaces.';
      } else if (!selectedNode) {
        promotionCopy.textContent = 'Select an insight first. Promotion is always explicit and keeps project boundaries visible.';
      } else if (!selectedTargetContext) {
        promotionCopy.textContent = 'Create another workspace before promoting reviewed insights across projects.';
      } else {
        promotionCopy.textContent = `Promote this reviewed insight into ${selectedTargetContext.name}. The promoted node keeps provenance back to the source workspace and insight.`;
      }

      const promotionMeta = [];
      if (selectedTargetContext) {
        promotionMeta.push({ title: 'Target workspace', detail: selectedTargetContext.name });
      }
      if (selectedInsight.branch) {
        promotionMeta.push({ title: 'Target workstream tag', detail: selectedInsight.branch });
      }
      const promotion = state.lastInsightPromotion;
      if (promotion && promotion.sourceNodeId === selectedNode?.id) {
        promotionMeta.push({
          title: promotion.created ? 'Last promotion' : 'Last promotion reused',
          detail: `${contextById(promotion.targetContextId)?.name || promotion.targetContextId} · ${short(promotion.targetNodeId || 'target node', 18)}`
        });
      }
      document.getElementById('insightPromotionMeta').innerHTML = promotionMeta.length > 0
        ? promotionMeta.map((item) => `<article><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></article>`).join('')
        : '<article><strong>Promotion is explicit</strong><p>Insights never cross workspaces silently. Promote only the reviewed memory you want another project to inherit.</p></article>';

      document.getElementById('knowledgeTable').innerHTML = nodes.length > 0
        ? nodes.slice(0, 400).map((node) => {
            const active = node.id === state.activeInsightNodeId ? ' class="active"' : '';
            const summary = insightSummary(node);
            const metaLine = [
              summary.source,
              summary.branch || null,
              summary.originContextId ? 'Promoted insight' : null
            ].filter(Boolean).join(' · ');
            return `
              <tr data-insight-id="${esc(node.id)}"${active}>
                <td>${renderChip(node.type || 'artifact', 'beige')}</td>
                <td>
                  <strong>${esc(short(summary.title, 72))}</strong>
                  ${metaLine ? `<div class="item-meta-line">${esc(metaLine)}</div>` : ''}
                </td>
                <td>${esc(node.key || '-')}</td>
                <td>${esc(formatTime(node.createdAt))}</td>
              </tr>
            `;
          }).join('')
        : '<tr><td colspan="4"><div class="empty-state">No insight nodes match the current filter.</div></td></tr>';
  }

  Object.assign(app, { renderKnowledge });
})();
