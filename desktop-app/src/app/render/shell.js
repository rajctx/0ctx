(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state, VIEW_META, SEARCH_HINTS, THEMES, THEME_STORAGE_KEY, activeContext, formatPosture, postureClass, short, esc } = app;

  function setText(selector, text) {
    if (typeof document?.querySelector !== 'function') {
      return;
    }
    const element = document.querySelector(selector);
    if (element) {
      element.textContent = text;
    }
  }

  function applyShellCopy() {
    setText('.nav-btn[data-view="setup"] span:last-child', 'Setup');
    setText('#runtimeBannerSetup', 'Open setup');
  }

  function normalizeTheme(value) {
    const candidate = String(value || '').trim().toLowerCase();
    return THEMES.includes(candidate) ? candidate : 'dark';
  }

  function applyTheme(theme, { persist = true } = {}) {
    const normalized = normalizeTheme(theme);
    state.theme = normalized;
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.dataset.theme = normalized;
    }
    if (typeof document !== 'undefined' && document.body) {
      document.body.dataset.theme = normalized;
    }
    if (persist) {
      try {
        window.localStorage?.setItem(THEME_STORAGE_KEY, normalized);
      } catch {}
    }
    return normalized;
  }

  function renderThemeToggle() {
    const activeTheme = applyTheme(state.theme, { persist: false });
    const summary = document.getElementById('themeSummary');
    if (summary) {
      summary.textContent = activeTheme === 'dark'
        ? 'Dark default. Use light only when you want a brighter reading surface.'
        : 'Light mode is active. Switch back to dark for the intended shell.';
    }
    ['dark', 'light'].forEach((theme) => {
      const button = document.getElementById(theme === 'dark' ? 'themeDarkBtn' : 'themeLightBtn');
      if (!button) {
        return;
      }
      const pressed = activeTheme === theme;
      button.classList.toggle('active', pressed);
      if (typeof button.setAttribute === 'function') {
        button.setAttribute('aria-pressed', String(pressed));
      }
    });
  }

  function setTheme(theme) {
    applyTheme(theme);
    renderThemeToggle();
    return state.theme;
  }

  function renderChrome() {
    applyShellCopy();
    renderThemeToggle();
    const posture = String(state.health?.status || 'offline').toLowerCase();
    const postureText = formatPosture(posture);
    document.body.dataset.view = state.view;
    document.querySelector('.main-stage')?.setAttribute('data-view', state.view);
    const sidebarPosture = document.getElementById('sidebarPosture');
    sidebarPosture.className = postureClass(posture);
    sidebarPosture.textContent = postureText;
    document.getElementById('search').placeholder = SEARCH_HINTS[state.view] || 'Filter this screen';

    const select = document.getElementById('ctxSel');
    if (state.contexts.length === 0) {
      select.innerHTML = '<option value="">No workspaces</option>';
    } else {
      select.innerHTML = state.contexts
        .map((context) => `<option value="${esc(context.id)}">${esc(context.name || context.id)}</option>`)
        .join('');
      if (state.activeContextId) {
        select.value = state.activeContextId;
      }
    }

    document.querySelectorAll('.nav-btn').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === state.view);
    });
    document.querySelectorAll('.view').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.view === state.view);
    });

    const context = activeContext();
    document.getElementById('sideWorkspaceName').textContent = context?.name || 'No workspace selected';
    const pathEl = document.getElementById('sideWorkspacePath');
    const workspacePath = Array.isArray(context?.paths) && context.paths.length > 0
      ? context.paths[0]
      : 'No repository folder bound.';
    pathEl.textContent = short(workspacePath, 42);
    pathEl.title = workspacePath;
    const summaryEl = document.getElementById('sideWorkspaceSummary');
    if (summaryEl) {
      summaryEl.textContent = `${state.branches.length} stream${state.branches.length === 1 ? '' : 's'} · ${state.allSessions.length} session${state.allSessions.length === 1 ? '' : 's'}`;
    }
    const bindingEl = document.getElementById('sideBinding');
    if (bindingEl) {
      bindingEl.textContent = Array.isArray(context?.paths) && context.paths.length > 0
        ? ''
        : 'Bind a repo folder so future capture can route here automatically.';
    }

    state.auth = { authenticated: true, provider: 'local' };
    document.getElementById('authBanner').classList.add('hidden');
  }

  function renderHero() {
    const meta = VIEW_META[state.view] || VIEW_META.branches;
    const context = activeContext();
    document.getElementById('stageCrumbBase').textContent = state.view === 'workspaces'
      ? 'Projects'
      : (context?.name || 'Projects');
    document.getElementById('stageCrumbCurrent').textContent = state.view === 'workspaces'
      ? 'Overview'
      : meta.title;
    const primary = document.getElementById('heroPrimary');
    primary.textContent = meta.primaryLabel;
    primary.dataset.action = meta.primaryAction;
    primary.disabled =
      (meta.primaryAction === 'create-checkpoint' && !state.activeSessionId)
      || (meta.primaryAction === 'explain-checkpoint' && !state.activeCheckpointId);
  }

  function renderRuntimeBanner() {
    const banner = document.getElementById('runtimeBanner');
    if (!state.runtimeIssue) {
      banner.classList.add('hidden');
      return;
    }
    document.getElementById('runtimeBannerTitle').textContent = state.runtimeIssue.title;
    document.getElementById('runtimeBannerText').textContent = state.runtimeIssue.detail;
    banner.classList.remove('hidden');
  }

  Object.assign(app, { applyShellCopy, normalizeTheme, applyTheme, renderThemeToggle, setTheme, renderChrome, renderHero, renderRuntimeBanner });
})();
