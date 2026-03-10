(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state } = app;

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function short(value, max = 120) {
    const text = String(value ?? '');
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
  }

  function cleanConversationText(value) {
    return String(value ?? '')
      .replace(/```/g, ' ')
      .replace(/[`*_>#]/g, ' ')
      .replace(/\r?\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitConversationText(value) {
    const combined = cleanConversationText(value);
    if (!combined) {
      return { prompt: '', reply: '', combined: '' };
    }

    for (const marker of [' -> ', ' => ', ' → ']) {
      const index = combined.indexOf(marker);
      if (index > 0 && index < combined.length - marker.length) {
        return {
          prompt: combined.slice(0, index).trim(),
          reply: combined.slice(index + marker.length).trim(),
          combined
        };
      }
    }

    return {
      prompt: '',
      reply: combined,
      combined
    };
  }

  function describeSession(session) {
    const parts = splitConversationText(session?.summary || '');
    return {
      title: short(parts.prompt || parts.reply || session?.sessionId || 'Untitled session', 96),
      preview: short(parts.reply || 'Open the session to inspect the latest captured turn.', 150),
      timeRange: `${formatTime(session?.startedAt)} to ${formatTime(session?.lastTurnAt)}`
    };
  }

  function describeTurn(turn) {
    const parts = splitConversationText(turn?.content || '');
    return {
      title: short(parts.prompt || parts.reply || turn?.nodeId || 'Untitled turn', 96),
      preview: short(parts.reply || 'No reply summary stored for this turn yet.', 170),
      prompt: parts.prompt,
      reply: parts.reply,
      combined: parts.combined
    };
  }

  function findAdjacentTurn(startIndex, step, role) {
    for (let index = startIndex + step; index >= 0 && index < state.turns.length; index += step) {
      const turn = state.turns[index];
      if (!turn) continue;
      if (!role || turn.role === role) {
        return turn;
      }
    }
    return null;
  }

  function describeSelectedTurn(turn) {
    const summary = describeTurn(turn);
    const index = state.turns.findIndex((entry) => entry.nodeId === turn.nodeId);
    const combinedText = summary.combined || summary.reply || summary.prompt || turn.content || '';

    if (turn.role === 'assistant') {
      const priorUser = findAdjacentTurn(index, -1, 'user');
      const priorSummary = priorUser ? describeTurn(priorUser) : null;
      return {
        title: summary.title,
        primaryLabel: 'Assistant message',
        primaryText: combinedText,
        secondaryLabel: 'Previous user message',
        secondaryText: priorSummary?.combined || priorSummary?.reply || priorUser?.content || 'No earlier user message was captured for this session.'
      };
    }

    if (turn.role === 'user') {
      const nextAssistant = findAdjacentTurn(index, 1, 'assistant');
      const nextSummary = nextAssistant ? describeTurn(nextAssistant) : null;
      return {
        title: summary.title,
        primaryLabel: 'User message',
        primaryText: combinedText,
        secondaryLabel: 'Next assistant message',
        secondaryText: nextSummary?.combined || nextSummary?.reply || nextAssistant?.content || 'No later assistant message is captured yet for this session.'
      };
    }

    const previousTurn = findAdjacentTurn(index, -1, null);
    const previousSummary = previousTurn ? describeTurn(previousTurn) : null;
    return {
      title: summary.title,
      primaryLabel: 'Captured message',
      primaryText: combinedText,
      secondaryLabel: 'Previous message',
      secondaryText: previousSummary?.combined || previousTurn?.content || 'No adjacent message available.'
    };
  }

  function basenameFromPath(value) {
    const text = String(value ?? '').trim().replace(/[\\/]+$/, '');
    if (!text) return '';
    const parts = text.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || text;
  }

  function humanizeLabel(value) {
    const text = String(value ?? '').trim();
    if (!text) return '-';
    return text
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function formatTime(value) {
    if (!value) return '-';
    const stamp = typeof value === 'number' ? value : Date.parse(String(value));
    if (!Number.isFinite(stamp)) return '-';
    return new Date(stamp).toLocaleString();
  }

  function formatRelativeTime(value) {
    if (!value) return 'Just now';
    const stamp = typeof value === 'number' ? value : Date.parse(String(value));
    if (!Number.isFinite(stamp)) return 'Unknown time';
    const diffMs = Date.now() - stamp;
    const future = diffMs < 0;
    const diff = Math.abs(diffMs);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    const suffix = future ? 'from now' : 'ago';
    if (diff < minute) return future ? 'In under a minute' : 'Just now';
    if (diff < hour) return `${Math.round(diff / minute)}m ${suffix}`;
    if (diff < day) return `${Math.round(diff / hour)}h ${suffix}`;
    if (diff < 7 * day) return `${Math.round(diff / day)}d ${suffix}`;
    return formatTime(stamp);
  }

  function commitShort(value) {
    const text = String(value || '').trim();
    return text ? text.slice(0, 8) : '';
  }

  function chipToneForAgent(agent) {
    const value = String(agent || '').toLowerCase();
    if (!value) return 'beige';
    if (value.includes('codex')) return 'blue';
    if (value.includes('antigravity')) return 'purple';
    if (value.includes('factory') || value.includes('droid')) return 'green';
    return 'beige';
  }

  function chipToneForRole(role) {
    const value = String(role || '').toLowerCase();
    if (value === 'assistant') return 'blue';
    if (value === 'user') return 'orange';
    if (value === 'system') return 'beige';
    return 'beige';
  }

  function renderChip(label, tone = 'beige', options = {}) {
    if (label == null || label === '') return '';
    const classes = ['chip', `chip-${tone}`];
    if (options.mono) classes.push('text-mono');
    if (options.compact) classes.push('chip-compact');
    return `<span class="${classes.join(' ')}">${esc(label)}</span>`;
  }

  function renderMetaLine(parts, options = {}) {
    const values = Array.isArray(parts)
      ? parts.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    if (values.length === 0) return '';
    const classes = ['item-meta-line'];
    if (options.mono) classes.push('text-mono');
    return `<p class="${classes.join(' ')}">${esc(values.join(' · '))}</p>`;
  }

  function summarizeCheckoutPaths(paths) {
    const values = Array.isArray(paths)
      ? [...new Set(paths.map((value) => String(value || '').trim()).filter(Boolean))]
      : [];
    if (values.length === 0) return '';
    const labels = values.slice(0, 2).map((value) => basenameFromPath(value) || value);
    return values.length > 2 ? `${labels.join(', ')}...` : labels.join(', ');
  }

  function describeWorkstreamCheckout(lane) {
    if (!lane) return '';
    const paths = Array.isArray(lane.checkedOutWorktreePaths) ? lane.checkedOutWorktreePaths : [];
    if (lane.checkedOutHere === true && lane.checkedOutElsewhere === true) {
      const elsewhereCount = Math.max(0, paths.length - 1);
      return elsewhereCount > 0
        ? `Checked out here + ${elsewhereCount} other worktree${elsewhereCount === 1 ? '' : 's'}`
        : 'Checked out here';
    }
    if (lane.checkedOutHere === true) {
      return 'Checked out here';
    }
    if (lane.checkedOutElsewhere === true) {
      const labels = summarizeCheckoutPaths(paths);
      return labels ? `Checked out elsewhere (${labels})` : 'Checked out elsewhere';
    }
    if (paths.length === 0) {
      return 'Not checked out in a known worktree';
    }
    return '';
  }

  function describeWorkstreamSync(lane) {
    if (!lane) return '';
    if (lane.stateSummary) {
      return String(lane.stateSummary);
    }
    const localChanges = describeWorkingTreeState(lane);
    const checkout = describeWorkstreamCheckout(lane);
    let summary = '';
    if (lane.isDetachedHead === true && lane.currentHeadSha) {
      summary = `Detached HEAD at ${commitShort(lane.currentHeadSha)}`;
    } else if (lane.headDiffersFromCaptured === true && lane.lastCommitSha && lane.currentHeadSha) {
      summary = `Capture drift: ${commitShort(lane.lastCommitSha)} -> ${commitShort(lane.currentHeadSha)}`;
    } else if (lane.baseline && typeof lane.baseline.summary === 'string' && lane.baseline.summary.trim()) {
      summary = lane.baseline.summary;
    } else if (typeof lane.aheadCount === 'number' && typeof lane.behindCount === 'number' && lane.upstream) {
      if (lane.aheadCount === 0 && lane.behindCount === 0) {
        summary = `In sync with ${lane.upstream}`;
      } else if (lane.aheadCount > 0 && lane.behindCount === 0) {
        summary = `${lane.aheadCount} ahead of ${lane.upstream}`;
      } else if (lane.aheadCount === 0 && lane.behindCount > 0) {
        summary = `${lane.behindCount} behind ${lane.upstream}`;
      } else {
        summary = `${lane.aheadCount} ahead / ${lane.behindCount} behind ${lane.upstream}`;
      }
    } else if (lane.isCurrent === true) {
      summary = 'Current local workstream';
    }

    if (checkout && summary && localChanges) {
      return `${checkout} - ${summary} - ${localChanges}`;
    }
    if (checkout && summary) {
      return `${checkout} - ${summary}`;
    }
    if (checkout && localChanges) {
      return `${checkout} - ${localChanges}`;
    }
    if (checkout) {
      return checkout;
    }
    if (summary && localChanges) {
      return `${summary} - ${localChanges}`;
    }
    if (summary) {
      return summary;
    }
    return localChanges;
  }

  function describeWorkstreamActionHint(lane) {
    if (!lane) return '';
    return String(lane.stateActionHint || '').trim();
  }

  function describeWorkingTreeState(lane) {
    if (!lane || lane.hasUncommittedChanges !== true) return '';
    const parts = [];
    if (typeof lane.stagedChangeCount === 'number' && lane.stagedChangeCount > 0) {
      parts.push(`${lane.stagedChangeCount} staged`);
    }
    if (typeof lane.unstagedChangeCount === 'number' && lane.unstagedChangeCount > 0) {
      parts.push(`${lane.unstagedChangeCount} unstaged`);
    }
    if (typeof lane.untrackedCount === 'number' && lane.untrackedCount > 0) {
      parts.push(`${lane.untrackedCount} untracked`);
    }
    return parts.join(', ');
  }

  function renderAgentChain(agentSet, lastAgent) {
    const ordered = Array.isArray(agentSet) && agentSet.length > 0
      ? [...new Set(agentSet.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))]
      : (lastAgent ? [lastAgent] : []);
    if (ordered.length === 0) {
      return renderChip('No agent', 'beige');
    }
    return `
      <div class="agent-chain">
        ${ordered.map((agent, index) => `
          ${index > 0 ? '<span class="arrow-separator">-></span>' : ''}
          ${renderChip(agent, chipToneForAgent(agent))}
        `).join('')}
      </div>
    `;
  }

  function activeSessionKnowledgePreview() {
    return state.sessionKnowledgePreview
      && state.sessionKnowledgePreview.sessionId === state.activeSessionId
      ? state.sessionKnowledgePreview
      : null;
  }

  function activeCheckpointKnowledgePreview() {
    return state.checkpointKnowledgePreview
      && state.checkpointKnowledgePreview.checkpointId === state.activeCheckpointId
      ? state.checkpointKnowledgePreview
      : null;
  }

  function selectedKnowledgeKeys(scope) {
    return scope === 'checkpoint'
      ? state.checkpointKnowledgeSelectedKeys
      : state.sessionKnowledgeSelectedKeys;
  }

  function setSelectedKnowledgeKeys(scope, keys) {
    const normalized = Array.isArray(keys)
      ? Array.from(new Set(keys.map((value) => String(value || '').trim()).filter(Boolean)))
      : [];
    if (scope === 'checkpoint') {
      state.checkpointKnowledgeSelectedKeys = normalized;
      return;
    }
    state.sessionKnowledgeSelectedKeys = normalized;
  }

  function selectKnowledgeCandidates(scope, mode) {
    const preview = scope === 'checkpoint' ? activeCheckpointKnowledgePreview() : activeSessionKnowledgePreview();
    if (!preview) return;
    let keys;
    if (mode === 'none') {
      keys = [];
    } else if (mode === 'new') {
      keys = preview.candidates
        .filter((candidate) => candidateDefaultSelectionEligible(candidate))
        .map((candidate) => candidate.key);
    } else {
      keys = preview.candidates.map((candidate) => candidate.key);
    }
    setSelectedKnowledgeKeys(scope, keys);
  }

  function formatConfidence(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return `${Math.round(numeric * 100)}% confidence`;
  }

  function confidenceTone(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 'beige';
    if (numeric >= 0.85) return 'green';
    if (numeric >= 0.72) return 'blue';
    return 'orange';
  }

  function formatReason(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    return text.replace(/[_-]+/g, ' ');
  }

  function formatReviewTier(value) {
    const tier = String(value || '').trim().toLowerCase();
    if (!tier) return null;
    if (tier === 'strong') return 'strong signal';
    if (tier === 'review') return 'review';
    if (tier === 'weak') return 'tentative';
    return tier;
  }

  function reviewTierTone(value) {
    const tier = String(value || '').trim().toLowerCase();
    if (tier === 'strong') return 'green';
    if (tier === 'review') return 'blue';
    return 'orange';
  }

  function formatEvidenceSummary(value) {
    const text = String(value || '').trim();
    return text || null;
  }

  function candidateDefaultSelectionEligible(candidate) {
    if (!candidate || candidate.action !== 'create' || candidate.reviewTier === 'weak') {
      return false;
    }
    if (candidate.reviewTier === 'strong') {
      return true;
    }
    const evidenceCount = Number(candidate.evidenceCount || 0);
    const distinctEvidenceCount = Number(candidate.distinctEvidenceCount || candidate.evidenceCount || 0);
    const roles = Array.isArray(candidate.corroboratedRoles)
      ? candidate.corroboratedRoles.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
      : [];
    if (distinctEvidenceCount > 1) {
      return true;
    }
    return roles.includes('user');
  }

  function renderKnowledgeCandidates(candidates, scope) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return '<div class="empty-state">No extractable insight candidates were found in this source.</div>';
    }
    const selected = new Set(selectedKnowledgeKeys(scope));
    return candidates.map((candidate) => `
      <article class="list-item preview-candidate">
        <div class="preview-row">
          <input
            class="preview-toggle"
            type="checkbox"
            data-preview-toggle="true"
            data-preview-scope="${esc(scope)}"
            data-candidate-key="${esc(candidate.key)}"
            ${selected.has(candidate.key) ? 'checked' : ''}
          />
            <div>
              <div class="preview-meta">
                ${renderChip(candidate.type || 'node', candidate.action === 'create' ? 'green' : 'beige')}
                ${renderChip(candidate.action === 'create' ? 'new node' : 'already in graph', candidate.action === 'create' ? 'green' : 'orange')}
                ${candidate.reviewTier ? renderChip(formatReviewTier(candidate.reviewTier), reviewTierTone(candidate.reviewTier)) : ''}
                ${candidate.confidence != null ? renderChip(formatConfidence(candidate.confidence), confidenceTone(candidate.confidence)) : ''}
                ${candidate.distinctEvidenceCount && candidate.distinctEvidenceCount > 1 ? renderChip(`${candidate.distinctEvidenceCount} distinct`, 'purple') : ''}
                ${candidate.evidenceCount && candidate.distinctEvidenceCount && candidate.evidenceCount > candidate.distinctEvidenceCount ? renderChip(`${candidate.evidenceCount} mentions`, 'beige') : ''}
                ${candidate.role ? renderChip(candidate.role, chipToneForRole(candidate.role)) : ''}
                ${candidate.messageId ? renderChip(short(candidate.messageId, 24), 'beige', { mono: true }) : ''}
              </div>
            <p class="preview-content">${esc(candidate.content || '')}</p>
            ${candidate.sourceExcerpt ? `<p class="preview-evidence">From: ${esc(candidate.sourceExcerpt)}</p>` : ''}
            <div class="preview-footnote">
              <span>${esc(formatTime(candidate.createdAt))}</span>
              ${formatEvidenceSummary(candidate.evidenceSummary) ? `<span>${esc(formatEvidenceSummary(candidate.evidenceSummary))}</span>` : ''}
              ${formatReason(candidate.reason) ? `<span>Why: ${esc(formatReason(candidate.reason))}</span>` : ''}
              ${candidate.reviewSummary ? `<span>${esc(candidate.reviewSummary)}</span>` : ''}
            </div>
          </div>
        </div>
      </article>
    `).join('');
  }

  function jsonText(value) {
    try {
      return JSON.stringify(value ?? null, null, 2);
    } catch {
      return String(value ?? '');
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  Object.assign(app, { esc, short, cleanConversationText, splitConversationText, describeSession, describeTurn, findAdjacentTurn, describeSelectedTurn, basenameFromPath, humanizeLabel, formatTime, formatRelativeTime, commitShort, chipToneForAgent, chipToneForRole, renderChip, renderMetaLine, summarizeCheckoutPaths, describeWorkstreamCheckout, describeWorkstreamSync, describeWorkstreamActionHint, describeWorkingTreeState, renderAgentChain, activeSessionKnowledgePreview, activeCheckpointKnowledgePreview, selectedKnowledgeKeys, setSelectedKnowledgeKeys, selectKnowledgeCandidates, formatConfidence, confidenceTone, formatReason, formatReviewTier, reviewTierTone, formatEvidenceSummary, candidateDefaultSelectionEligible, renderKnowledgeCandidates, jsonText, delay });
})();
