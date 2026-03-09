(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state, activeBranch, activeInsightNode, activeSessionKnowledgePreview, activeCheckpointKnowledgePreview, selectedKnowledgeKeys, setSelectedKnowledgeKeys, extractTagValue, contextById, basenameFromPath, setStatus, setView, daemon, loadGraph, loadBranches, loadCheckpoints, loadCheckpointDetail, loadBranchComparisonSafe, loadDataPolicy, refreshAll, renderAll, enableCommand, hookInstallCommand, methodSupported, resetBranchScopedState, debugArtifactsEnabled } = app;

  async function createContext(event) {
    event.preventDefault();
    const nameInput = document.getElementById('ctxName');
    const pathInput = document.getElementById('ctxPath');
    const repoPath = String(pathInput.value || '').trim();
    const name = String(nameInput.value || '').trim() || basenameFromPath(repoPath);
    if (!name) {
      setStatus('Workspace name or repository folder is required.');
      return;
    }
    const params = repoPath ? { name, paths: [repoPath] } : { name };
    try {
      const created = await daemon('createContext', params);
      if (created?.id) {
        state.activeContextId = created.id;
        state.activeBranchKey = null;
        resetBranchScopedState();
      }
      nameInput.value = '';
      pathInput.value = '';
      await refreshAll();
      setView('workspaces');
    } catch (error) {
      setStatus(`Create workspace failed: ${String(error)}`);
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`Copied: ${text}`);
    } catch {
      setStatus('Clipboard copy failed.');
    }
  }

  async function applyDataPolicyPreset(preset) {
    if (!methodSupported('setDataPolicy')) {
      setStatus('Update the local runtime before changing data policy from the desktop.');
      return;
    }

    const normalized = String(preset || '').trim().toLowerCase();
    if (!['lean', 'review', 'debug', 'shared'].includes(normalized)) {
      setStatus('Choose a valid data policy preset.');
      return;
    }
    if (normalized === 'shared' && !state.activeContextId) {
      setStatus('Shared requires an active workspace because it opts that workspace into full sync.');
      return;
    }

    try {
      const result = await daemon('setDataPolicy', {
        ...(state.activeContextId ? { contextId: state.activeContextId } : {}),
        preset: normalized
      });
      state.dataPolicy = result;
      await loadDataPolicy();
      renderAll();
      setStatus(`Applied ${normalized} data policy.`);
    } catch (error) {
      setStatus(`Update data policy failed: ${String(error)}`);
    }
  }

  function debugPayloadAllowed() {
    return debugArtifactsEnabled();
  }

  async function createCheckpointFromActiveSession() {
    if (!state.activeContextId || !state.activeSessionId) {
      setStatus('Select a session before creating a checkpoint.');
      return;
    }
    try {
      const result = await daemon('createSessionCheckpoint', {
        contextId: state.activeContextId,
        sessionId: state.activeSessionId
      });
      state.activeCheckpointId = result?.id || state.activeCheckpointId;
      await loadBranches();
      await loadCheckpoints();
      await loadCheckpointDetail();
      await loadBranchComparisonSafe();
      renderAll();
      setView('checkpoints');
      const knowledge = result?.knowledge;
      const promoted = Number(knowledge?.createdCount || 0);
      const reused = Number(knowledge?.reusedCount || 0);
      const knowledgeSuffix = promoted > 0 || reused > 0
        ? ` | insights ${promoted} new, ${reused} reused`
        : '';
      setStatus(`Created checkpoint ${result?.name || result?.id || ''}${knowledgeSuffix}`.trim());
    } catch (error) {
      setStatus(`Create checkpoint failed: ${String(error)}`);
    }
  }

  async function previewKnowledgeFromActiveSession() {
    if (!state.activeContextId || !state.activeSessionId) {
      setStatus('Select a session before previewing insights.');
      return;
    }
    try {
      const result = await daemon('previewSessionKnowledge', {
        contextId: state.activeContextId,
        sessionId: state.activeSessionId
      });
      state.sessionKnowledgePreview = result;
      const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
      const preferred = candidates
        .filter((candidate) => candidate.action === 'create' && Number(candidate.confidence || 0) >= 0.72)
        .map((candidate) => candidate.key);
      const fallback = candidates
        .filter((candidate) => candidate.action === 'create')
        .map((candidate) => candidate.key);
      const selected = preferred.length > 0 ? preferred : fallback;
      setSelectedKnowledgeKeys('session', selected);
      renderAll();
      setStatus(`Insight preview ready: ${String(result?.candidateCount || 0)} candidates, ${String(result?.createCount || 0)} new, ${selected.length} preselected.`);
    } catch (error) {
      setStatus(`Preview insights failed: ${String(error)}`);
    }
  }

  async function extractKnowledgeFromActiveSession() {
    if (!state.activeContextId || !state.activeSessionId) {
      setStatus('Select a session before saving insights.');
      return;
    }
    try {
      const preview = activeSessionKnowledgePreview();
      const candidateKeys = preview ? selectedKnowledgeKeys('session') : undefined;
      if (preview && candidateKeys.length === 0) {
        setStatus('Select at least one insight candidate before saving.');
        return;
      }
      const result = await daemon('extractSessionKnowledge', {
        contextId: state.activeContextId,
        sessionId: state.activeSessionId,
        candidateKeys
      });
      state.sessionKnowledgePreview = null;
      state.sessionKnowledgeSelectedKeys = [];
      await loadGraph();
      renderAll();
      const nodeCount = Number(result?.nodeCount || 0);
      if (nodeCount > 0) {
        setView('knowledge');
      }
      setStatus(`Insights saved: ${String(result?.createdCount || 0)} created, ${String(result?.reusedCount || 0)} reused.`);
    } catch (error) {
      setStatus(`Save insights failed: ${String(error)}`);
    }
  }

  async function previewKnowledgeFromActiveCheckpoint() {
    if (!state.activeCheckpointId) {
      setStatus('Select a checkpoint before previewing insights.');
      return;
    }
    try {
      const result = await daemon('previewCheckpointKnowledge', {
        checkpointId: state.activeCheckpointId
      });
      state.checkpointKnowledgePreview = result;
      const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
      const preferred = candidates
        .filter((candidate) => candidate.action === 'create' && Number(candidate.confidence || 0) >= 0.72)
        .map((candidate) => candidate.key);
      const fallback = candidates
        .filter((candidate) => candidate.action === 'create')
        .map((candidate) => candidate.key);
      const selected = preferred.length > 0 ? preferred : fallback;
      setSelectedKnowledgeKeys('checkpoint', selected);
      renderAll();
      setStatus(`Checkpoint insight preview ready: ${String(result?.candidateCount || 0)} candidates, ${String(result?.createCount || 0)} new, ${selected.length} preselected.`);
    } catch (error) {
      setStatus(`Preview checkpoint insights failed: ${String(error)}`);
    }
  }

  async function extractKnowledgeFromActiveCheckpoint() {
    if (!state.activeCheckpointId) {
      setStatus('Select a checkpoint before saving insights.');
      return;
    }
    try {
      const preview = activeCheckpointKnowledgePreview();
      const candidateKeys = preview ? selectedKnowledgeKeys('checkpoint') : undefined;
      if (preview && candidateKeys.length === 0) {
        setStatus('Select at least one checkpoint insight candidate before saving.');
        return;
      }
      const result = await daemon('extractCheckpointKnowledge', {
        contextId: state.activeContextId,
        checkpointId: state.activeCheckpointId,
        candidateKeys
      });
      state.checkpointKnowledgePreview = null;
      state.checkpointKnowledgeSelectedKeys = [];
      await loadGraph();
      renderAll();
      const nodeCount = Number(result?.nodeCount || 0);
      if (nodeCount > 0) {
        setView('knowledge');
      }
      setStatus(`Checkpoint insights saved: ${String(result?.createdCount || 0)} created, ${String(result?.reusedCount || 0)} reused.`);
    } catch (error) {
      setStatus(`Save checkpoint insights failed: ${String(error)}`);
    }
  }

  async function promoteActiveInsight() {
    const sourceContext = state.activeContextId;
    const node = activeInsightNode();
    const targetContextId = state.promotionTargetContextId;
    if (!sourceContext || !node) {
      setStatus('Select an insight before promoting it.');
      return;
    }
    if (!targetContextId) {
      setStatus('Choose another workspace before promoting this insight.');
      return;
    }
    if (!methodSupported('promoteInsight')) {
      setStatus('Update the local runtime before promoting reviewed insights across workspaces.');
      return;
    }

    const activeLane = activeBranch();
    const branch = extractTagValue(node.tags, 'branch:') || activeLane?.branch || undefined;
    const worktreePath = extractTagValue(node.tags, 'worktree:') || activeLane?.worktreePath || undefined;
    const targetContext = contextById(targetContextId);

    try {
      const result = await daemon('promoteInsight', {
        contextId: targetContextId,
        sourceContextId: sourceContext,
        nodeId: node.id,
        branch,
        worktreePath
      });
      state.lastInsightPromotion = result;
      renderAll();
      setStatus(`Promoted insight to ${targetContext?.name || targetContextId} (${result?.created ? 'created' : 'reused'}).`);
    } catch (error) {
      setStatus(`Promote insight failed: ${String(error)}`);
    }
  }

  async function explainActiveCheckpoint() {
    if (!state.activeCheckpointId) {
      setStatus('Select a checkpoint first.');
      return;
    }
    try {
      state.checkpointDetail = await daemon('explainCheckpoint', { checkpointId: state.activeCheckpointId });
      await loadCheckpointDetail();
      renderAll();
      setView('checkpoints');
      setStatus(`Loaded checkpoint detail ${state.activeCheckpointId}`);
    } catch (error) {
      setStatus(`Explain checkpoint failed: ${String(error)}`);
    }
  }

  async function rewindActiveCheckpoint() {
    if (!state.activeCheckpointId) {
      setStatus('Select a checkpoint first.');
      return;
    }
    try {
      const result = await daemon('rewindCheckpoint', { checkpointId: state.activeCheckpointId });
      await refreshAll();
      state.activeCheckpointId = result?.checkpoint?.id || state.activeCheckpointId;
      setView('checkpoints');
      setStatus(`Rewound workspace to checkpoint ${state.activeCheckpointId}`);
    } catch (error) {
      setStatus(`Rewind failed: ${String(error)}`);
    }
  }

  async function performHeroAction(action) {
    switch (action) {
      case 'go-branches':
        setView('branches');
        return;
      case 'go-sessions':
        setView('sessions');
        return;
      case 'go-setup':
        setView('setup');
        return;
      case 'refresh':
        await refreshAll();
        return;
      case 'focus-create':
        setView('workspaces');
        document.getElementById('ctxName').focus();
        return;
      case 'toggle-hidden':
        state.includeHidden = !state.includeHidden;
        await loadGraph();
        renderAll();
        return;
        case 'copy-enable':
          await copyText(enableCommand());
          return;
        case 'copy-install':
          await copyText(hookInstallCommand());
          return;
      case 'create-checkpoint':
        await createCheckpointFromActiveSession();
        return;
      case 'explain-checkpoint':
        await explainActiveCheckpoint();
        return;
      default:
        return;
    }
  }

  async function toggleSelectedPayload() {
    if (!debugPayloadAllowed()) {
      setStatus('Debug payload inspection is disabled by policy. Enable debug artifacts in Utilities if you need support-level payload access.');
      return;
    }
    const turn = app.selectedTurn();
    if (!turn || !turn.hasPayload) return;
    const nextExpanded = !state.payloadExpanded;
    state.payloadExpanded = nextExpanded;
    if (nextExpanded && state.payloadNodeId !== turn.nodeId) {
      await app.loadPayload(turn.nodeId);
    }
    if (!nextExpanded) {
      state.payload = null;
      state.payloadNodeId = turn.nodeId;
    }
    app.renderSessions();
  }

  Object.assign(app, { createContext, copyText, applyDataPolicyPreset, createCheckpointFromActiveSession, previewKnowledgeFromActiveSession, extractKnowledgeFromActiveSession, previewKnowledgeFromActiveCheckpoint, extractKnowledgeFromActiveCheckpoint, promoteActiveInsight, explainActiveCheckpoint, rewindActiveCheckpoint, performHeroAction, toggleSelectedPayload });
})();
