(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state, renderChrome, renderHero, renderRuntimeBanner, renderBranches, renderSessions, renderWorkspaces, renderCheckpoints, renderKnowledge, renderSetup } = app;

  function setView(view) {
    state.view = view;
    renderAll();
  }

  function renderAll() {
    renderChrome();
    renderHero();
    renderRuntimeBanner();
    renderBranches();
    renderSessions();
    renderWorkspaces();
    renderCheckpoints();
    renderKnowledge();
    renderSetup();
  }

  Object.assign(app, { setView, renderAll });
})();
