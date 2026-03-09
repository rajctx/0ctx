(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state, bindById, setView, renderAll, selectContext, resetBranchScopedState, loadBranches, loadSessions, loadSessionDetail, loadTurns, loadCheckpoints, loadCheckpointDetail, loadHandoff, loadBranchComparisonSafe, loadWorkspaceComparison, loadGraph, refreshAll, setStatus, invoke, copyText, createContext, applyDataPolicyPreset, performHeroAction, createCheckpointFromActiveSession, previewKnowledgeFromActiveSession, extractKnowledgeFromActiveSession, previewKnowledgeFromActiveCheckpoint, extractKnowledgeFromActiveCheckpoint, promoteActiveInsight, rewindActiveCheckpoint, explainActiveCheckpoint, hookInstallCommand, selectKnowledgeCandidates, selectedKnowledgeKeys, setSelectedKnowledgeKeys, syncBranchSelectionFromSession, startBackgroundRefreshLoops, basenameFromPath } = app;

  function wire() {
    document.querySelectorAll('.nav-btn').forEach((button) => {
      button.addEventListener('click', () => setView(button.dataset.view || 'branches'));
    });

    bindById('search', 'input', (event) => {
      state.q = String(event.target.value || '').trim();
      renderAll();
    });

    bindById('ctxSel', 'change', async (event) => {
      const nextId = String(event.target.value || '');
      if (!nextId) return;
      await selectContext(nextId);
      state.activeBranchKey = null;
      resetBranchScopedState();
      await loadBranches();
      await loadSessions();
      await loadSessionDetail();
      await loadTurns();
      await loadCheckpoints();
      await loadCheckpointDetail();
      await loadHandoff();
      await loadGraph();
      renderAll();
    });

    bindById('refresh', 'click', () => void refreshAll());
    bindById('restart', 'click', async () => {
      try {
        const result = await invoke('restart_connector', {});
        setStatus(String(result || 'Connector restarted.'));
        await refreshAll();
      } catch (error) {
        setStatus(`Restart failed: ${String(error)}`);
      }
    });

    bindById('copyLogin', 'click', () => void copyText('0ctx shell'));
    bindById('runtimeBannerRefresh', 'click', () => void refreshAll());
    bindById('runtimeBannerSetup', 'click', () => setView('setup'));
    bindById('heroPrimary', 'click', (event) => void performHeroAction(event.currentTarget.dataset.action));
    bindById('ctxForm', 'submit', createContext);
    bindById('pickFolder', 'click', async () => {
      try {
        const selected = await invoke('pick_workspace_folder', {});
        if (!selected) {
          setStatus('Folder selection cancelled.');
          return;
        }
        const pathInput = document.getElementById('ctxPath');
        const nameInput = document.getElementById('ctxName');
        pathInput.value = String(selected);
        if (!String(nameInput.value || '').trim()) {
          nameInput.value = basenameFromPath(selected);
        }
        setStatus(`Selected workspace folder ${selected}`);
      } catch (error) {
        setStatus(`Folder picker failed: ${String(error)}`);
      }
    });
    bindById('inclHidden', 'change', async (event) => {
      state.includeHidden = Boolean(event.target.checked);
      await loadGraph();
      renderAll();
    });
    const createCheckpointBtn = document.getElementById('createCheckpointBtn');
    if (createCheckpointBtn) {
      createCheckpointBtn.addEventListener('click', () => void createCheckpointFromActiveSession());
    }
    const previewSessionKnowledgeBtn = document.getElementById('previewSessionKnowledgeBtn');
    if (previewSessionKnowledgeBtn) {
      previewSessionKnowledgeBtn.addEventListener('click', () => void previewKnowledgeFromActiveSession());
    }
    const extractSessionKnowledgeBtn = document.getElementById('extractSessionKnowledgeBtn');
    if (extractSessionKnowledgeBtn) {
      extractSessionKnowledgeBtn.addEventListener('click', () => void extractKnowledgeFromActiveSession());
    }
    const previewCheckpointKnowledgeBtn = document.getElementById('previewCheckpointKnowledgeBtn');
    if (previewCheckpointKnowledgeBtn) {
      previewCheckpointKnowledgeBtn.addEventListener('click', () => void previewKnowledgeFromActiveCheckpoint());
    }
    const extractCheckpointKnowledgeBtn = document.getElementById('extractCheckpointKnowledgeBtn');
    if (extractCheckpointKnowledgeBtn) {
      extractCheckpointKnowledgeBtn.addEventListener('click', () => void extractKnowledgeFromActiveCheckpoint());
    }
    bindById('promoteInsightBtn', 'click', () => void promoteActiveInsight());
    bindById('rewindCheckpointBtn', 'click', () => void rewindActiveCheckpoint());
    bindById('explainCheckpointBtn', 'click', () => void explainActiveCheckpoint());

    bindById('copyHookInstall', 'click', () => void copyText(hookInstallCommand()));
    bindById('copyShell', 'click', () => void copyText('0ctx shell'));
    bindById('copyRepair', 'click', () => void copyText('0ctx repair'));
    bindById('copyDoctor', 'click', () => void copyText('0ctx doctor'));
    bindById('checkUpdates', 'click', async () => {
      try {
        const result = await invoke('check_for_updates', {});
        setStatus(String(result || 'Update check completed.'));
      } catch (error) {
        setStatus(`Update check failed: ${String(error)}`);
      }
    });

    document.body.addEventListener('click', async (event) => {
      const previewAction = event.target.closest('[data-preview-action]');
      if (previewAction) {
        const scope = String(previewAction.getAttribute('data-preview-scope') || 'session');
        const action = String(previewAction.getAttribute('data-preview-action') || 'all');
        selectKnowledgeCandidates(scope, action);
        renderAll();
        return;
      }

      const bannerAction = event.target.closest('[data-banner-action]');
      if (bannerAction) {
        const action = bannerAction.getAttribute('data-banner-action');
        if (action === 'refresh') {
          await refreshAll();
        } else if (action === 'setup') {
          setView('setup');
        }
        return;
      }

      const navTarget = event.target.closest('[data-nav]');
      if (navTarget) {
        setView(navTarget.dataset.nav || 'branches');
        return;
      }

      const policyPresetTarget = event.target.closest('[data-policy-preset]');
      if (policyPresetTarget) {
        await applyDataPolicyPreset(policyPresetTarget.getAttribute('data-policy-preset'));
        return;
      }

      const branchTarget = event.target.closest('[data-branch-key]');
        if (branchTarget) {
          state.activeBranchKey = String(branchTarget.getAttribute('data-branch-key'));
          state.activeSessionId = null;
          state.sessionDetail = null;
          state.sessionKnowledgePreview = null;
          state.sessionKnowledgeSelectedKeys = [];
          state.activeTurnId = null;
          state.activeCheckpointId = null;
          state.checkpointDetail = null;
          state.checkpointSessionDetail = null;
          state.checkpointKnowledgePreview = null;
          state.checkpointKnowledgeSelectedKeys = [];
        await loadSessions();
        await loadSessionDetail();
        await loadTurns();
        await loadCheckpoints();
        await loadCheckpointDetail();
        await loadHandoff();
        await loadBranchComparisonSafe();
        renderAll();
        return;
      }

      const sessionTarget = event.target.closest('[data-session-id]');
      if (sessionTarget) {
        const nextSessionId = String(sessionTarget.getAttribute('data-session-id'));
        const session = state.allSessions.find((item) => item.sessionId === nextSessionId)
          || state.sessions.find((item) => item.sessionId === nextSessionId)
          || null;
        syncBranchSelectionFromSession(session);
          await loadSessions();
          state.activeSessionId = nextSessionId;
          state.sessionKnowledgePreview = null;
          state.sessionKnowledgeSelectedKeys = [];
          state.activeTurnId = null;
        await loadSessionDetail();
        await loadTurns();
        await loadCheckpoints();
        await loadCheckpointDetail();
        await loadHandoff();
        await loadBranchComparisonSafe();
        if (sessionTarget.dataset.openView) {
          setView(sessionTarget.dataset.openView);
        }
        renderAll();
        return;
      }

      const turnTarget = event.target.closest('[data-turn-id]');
      if (turnTarget) {
        state.activeTurnId = String(turnTarget.getAttribute('data-turn-id'));
        if (turnTarget.dataset.openView) {
          setView(turnTarget.dataset.openView);
        }
        renderAll();
        return;
      }

      const checkpointTarget = event.target.closest('[data-checkpoint-id]');
        if (checkpointTarget) {
          state.activeCheckpointId = String(checkpointTarget.getAttribute('data-checkpoint-id'));
          state.checkpointKnowledgePreview = null;
          state.checkpointKnowledgeSelectedKeys = [];
          await loadCheckpointDetail();
          setView('checkpoints');
          renderAll();
        return;
      }

      const insightTarget = event.target.closest('[data-insight-id]');
      if (insightTarget) {
        state.activeInsightNodeId = String(insightTarget.getAttribute('data-insight-id'));
        renderAll();
        return;
      }

      const contextTarget = event.target.closest('[data-context-id]');
      if (contextTarget) {
        const contextId = String(contextTarget.getAttribute('data-context-id'));
        await selectContext(contextId);
        state.activeBranchKey = null;
        resetBranchScopedState();
        await loadBranches();
        await loadSessions();
        await loadSessionDetail();
        await loadTurns();
        await loadCheckpoints();
        await loadCheckpointDetail();
        await loadHandoff();
        await loadBranchComparisonSafe();
        await loadWorkspaceComparison();
        await loadGraph();
        renderAll();
      }
    });

    document.body.addEventListener('change', (event) => {
      const compareSelect = event.target.closest('#branchCompareSelect');
      if (compareSelect) {
        state.comparisonTargetKey = String(compareSelect.value || '').trim() || null;
        void (async () => {
          await loadBranchComparisonSafe();
          renderAll();
        })();
        return;
      }
      const promotionTarget = event.target.closest('#insightTargetContext');
      if (promotionTarget) {
        state.promotionTargetContextId = String(promotionTarget.value || '').trim() || null;
        renderAll();
        return;
      }
      const workspaceCompareTarget = event.target.closest('#workspaceCompareSelect');
      if (workspaceCompareTarget) {
        state.workspaceComparisonTargetContextId = String(workspaceCompareTarget.value || '').trim() || null;
        void (async () => {
          await loadWorkspaceComparison();
          renderAll();
        })();
        return;
      }
      const toggle = event.target.closest('[data-preview-toggle]');
      if (!toggle) return;
      const scope = String(toggle.getAttribute('data-preview-scope') || 'session');
      const key = String(toggle.getAttribute('data-candidate-key') || '').trim();
      if (!key) return;
      const current = new Set(selectedKnowledgeKeys(scope));
      if (toggle.checked) {
        current.add(key);
      } else {
        current.delete(key);
      }
      setSelectedKnowledgeKeys(scope, Array.from(current));
      renderAll();
    });

    if (window.__TAURI__ && window.__TAURI__.event && typeof window.__TAURI__.event.listen === 'function') {
      window.__TAURI__.event.listen('posture-changed', (event) => {
        const posture = String(event?.payload || 'offline');
        const badge = document.getElementById('postureBadge');
        const sidebarBadge = document.getElementById('sidebarPosture');
        badge.className = postureClass(posture);
        badge.textContent = formatPosture(posture);
        sidebarBadge.className = postureClass(posture);
        sidebarBadge.textContent = formatPosture(posture);
      });
    }
  }

  async function boot() {
    wire();
    renderAll();
    setStatus('Booting desktop dashboard...');
    await refreshAll();
    startBackgroundRefreshLoops();
  }

  void boot();

  Object.assign(app, { wire, boot });
})();



