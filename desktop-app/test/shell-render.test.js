function createElement(initialClasses = []) {
  const classSet = new Set(initialClasses);
  const attributes = new Map();
  return {
    textContent: '',
    innerHTML: '',
    disabled: false,
    title: '',
    value: '',
    placeholder: '',
    dataset: {},
    classList: {
      add(...tokens) {
        tokens.forEach((token) => classSet.add(token));
      },
      remove(...tokens) {
        tokens.forEach((token) => classSet.delete(token));
      },
      toggle(token, force) {
        if (force === undefined) {
          if (classSet.has(token)) {
            classSet.delete(token);
            return false;
          }
          classSet.add(token);
          return true;
        }
        if (force) {
          classSet.add(token);
          return true;
        }
        classSet.delete(token);
        return false;
      },
      contains(token) {
        return classSet.has(token);
      }
    },
    get className() {
      return Array.from(classSet).join(' ');
    },
    set className(value) {
      classSet.clear();
      String(value || '').split(/\s+/).filter(Boolean).forEach((token) => classSet.add(token));
    },
    setAttribute(name, value) {
      attributes.set(String(name), String(value));
    },
    getAttribute(name) {
      return attributes.get(String(name)) || '';
    }
  };
}

function createEnvironment({ initialTheme = 'dark' } = {}) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) {
      const hiddenByDefault = new Set(['authBanner', 'runtimeBanner']);
      elements.set(id, createElement(hiddenByDefault.has(id) ? ['hidden'] : []));
    }
    return elements.get(id);
  };

  const setupLabel = createElement();
  const mainStage = createElement();
  const navButtons = ['workspaces', 'branches', 'sessions', 'checkpoints', 'knowledge', 'setup'].map((view) => {
    const button = createElement(view === 'sessions' ? ['active'] : []);
    button.dataset.view = view;
    return button;
  });
  const viewPanels = ['workspaces', 'branches', 'sessions', 'checkpoints', 'knowledge', 'setup'].map((view) => {
    const panel = createElement(view === 'sessions' ? ['active'] : []);
    panel.dataset.view = view;
    return panel;
  });

  const localStore = new Map();
  if (initialTheme) {
    localStore.set('octx.desktop.theme', initialTheme);
  }

  global.document = {
    body: createElement(),
    documentElement: { dataset: { theme: initialTheme } },
    getElementById: getElement,
    querySelector(selector) {
      if (selector === '.nav-btn[data-view="setup"] span:last-child') {
        return setupLabel;
      }
      if (selector === '#runtimeBannerSetup') {
        return getElement('runtimeBannerSetup');
      }
      if (selector === '.main-stage') {
        return mainStage;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.nav-btn') {
        return navButtons;
      }
      if (selector === '.view') {
        return viewPanels;
      }
      return [];
    }
  };

  global.window = {
    localStorage: {
      getItem(key) {
        return localStore.has(key) ? localStore.get(key) : null;
      },
      setItem(key, value) {
        localStore.set(String(key), String(value));
      }
    },
    location: { search: '', hash: '' },
    __TAURI__: null
  };

  return { getElement, setupLabel, mainStage, localStore };
}

function loadScript(relativePath) {
  const resolved = require.resolve(relativePath);
  delete require.cache[resolved];
  require(relativePath);
}

afterEach(() => {
  delete global.window;
  delete global.document;
});

describe('desktop shell theme and hero actions', () => {
  it('boots from the stored theme and persists explicit theme changes', () => {
    const { getElement, localStore } = createEnvironment({ initialTheme: 'light' });
    loadScript('../src/app/config.js');
    loadScript('../src/app/helpers.js');
    loadScript('../src/app/selectors.js');
    loadScript('../src/app/render/shell.js');

    const app = global.window.OctxDesktop;
    app.state.health = { status: 'connected' };
    app.renderChrome();

    expect(app.state.theme).toBe('light');
    expect(global.document.documentElement.dataset.theme).toBe('light');
    expect(getElement('themeLightBtn').classList.contains('active')).toBe(true);
    expect(getElement('themeDarkBtn').classList.contains('active')).toBe(false);

    app.setTheme('dark');

    expect(app.state.theme).toBe('dark');
    expect(global.document.documentElement.dataset.theme).toBe('dark');
    expect(localStore.get('octx.desktop.theme')).toBe('dark');
    expect(getElement('themeDarkBtn').getAttribute('aria-pressed')).toBe('true');
    expect(getElement('themeLightBtn').getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps checkpoint and session primary actions in the topbar and disables them until selection exists', () => {
    createEnvironment({ initialTheme: 'dark' });
    loadScript('../src/app/config.js');
    loadScript('../src/app/helpers.js');
    loadScript('../src/app/selectors.js');
    loadScript('../src/app/render/shell.js');

    const app = global.window.OctxDesktop;
    app.state.contexts = [{ id: 'ctx-1', name: 'Inbox Agent', paths: ['C:/repo'] }];
    app.state.activeContextId = 'ctx-1';

    app.state.view = 'sessions';
    app.state.activeSessionId = null;
    app.renderHero();
    expect(global.document.getElementById('heroPrimary').textContent).toBe('Create checkpoint');
    expect(global.document.getElementById('heroPrimary').dataset.action).toBe('create-checkpoint');
    expect(global.document.getElementById('heroPrimary').disabled).toBe(true);

    app.state.activeSessionId = 'session-1';
    app.renderHero();
    expect(global.document.getElementById('heroPrimary').disabled).toBe(false);

    app.state.view = 'checkpoints';
    app.state.activeCheckpointId = null;
    app.renderHero();
    expect(global.document.getElementById('heroPrimary').textContent).toBe('Explain checkpoint');
    expect(global.document.getElementById('heroPrimary').dataset.action).toBe('explain-checkpoint');
    expect(global.document.getElementById('heroPrimary').disabled).toBe(true);

    app.state.activeCheckpointId = 'checkpoint-1';
    app.renderHero();
    expect(global.document.getElementById('heroPrimary').disabled).toBe(false);
  });
});
