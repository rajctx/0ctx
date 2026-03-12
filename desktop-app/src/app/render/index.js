(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state, renderChrome, renderHero, renderRuntimeBanner, renderBranches, renderSessions, renderWorkspaces, renderCheckpoints, renderKnowledge, renderSetup } = app;
  const renderers = {
    branches: renderBranches,
    sessions: renderSessions,
    workspaces: renderWorkspaces,
    checkpoints: renderCheckpoints,
    knowledge: renderKnowledge,
    setup: renderSetup
  };

  function setView(view) {
    state.view = view;
    renderAll();
  }

  function renderAll() {
    renderChrome();
    renderHero();
    renderRuntimeBanner();
    const renderActiveView = renderers[state.view] || renderWorkspaces;
    renderActiveView();
  }

  Object.assign(app, { setView, renderAll });
})();
