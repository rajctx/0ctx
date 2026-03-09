(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state, bridge, MUTATION_EVENT_TYPES, EVENT_POLL_MS, HEALTH_REFRESH_MS, delay, missingRequiredMethods, renderChrome, renderRuntimeBanner, renderAll, resetBranchScopedState, setStatus, refreshAll } = app;
  let eventPollTimer = null;
  let healthRefreshTimer = null;
  let eventPollInFlight = false;

  function setRuntimeIssue(title, detail) {
    state.runtimeIssue = {
      title: title || 'Runtime issue',
      detail: detail || 'The desktop app could not reach the local runtime.'
    };
  }

  function hasRelevantMutation(events) {
    return Array.isArray(events) && events.some((event) => {
      const type = String(event?.type || '').trim();
      if (MUTATION_EVENT_TYPES.has(type)) {
        return true;
      }
      const method = String(event?.payload?.method || '').trim();
      return method.length > 0;
    });
  }

  async function clearEventSubscription(options = {}) {
    const quiet = options.quiet === true;
    const subscriptionId = state.subscriptionId;
    state.subscriptionId = null;
    state.subscriptionContextId = null;
    state.lastSeq = 0;
    if (!subscriptionId || !bridge) {
      return;
    }
    try {
      await invoke('unsubscribe_events', { subscriptionId });
    } catch (error) {
      if (!quiet) {
        setStatus(`Event subscription cleanup failed: ${String(error)}`);
      }
    }
  }

  async function ensureEventSubscription(options = {}) {
    if (!bridge || state.runtimeIssue) {
      return;
    }
    const force = options.force === true;
    const targetContextId = state.activeContextId || null;
    if (!force && state.subscriptionId && state.subscriptionContextId === targetContextId) {
      return;
    }

    await clearEventSubscription({ quiet: true });
    const payload = {};
    if (targetContextId) {
      payload.contextId = targetContextId;
    }
    const result = await invoke('subscribe_events', payload);
    state.subscriptionId = result?.subscriptionId || null;
    state.subscriptionContextId = targetContextId;
    state.lastSeq = Number(result?.lastAckedSequence || 0) || 0;
  }

  async function refreshRuntimeHealth() {
    try {
      const status = await requestDaemonStatus(0);
      state.health = status?.health || {};
      state.caps = Array.isArray(status?.capabilities?.methods) ? status.capabilities.methods : [];
      state.storage = status?.storage || {};
      const contexts = Array.isArray(status?.contexts) ? status.contexts : [];
      const activeStillExists = state.activeContextId && contexts.some((context) => context.id === state.activeContextId);
      state.contexts = contexts;

      if (!activeStillExists) {
        state.activeContextId = contexts[0]?.id || null;
        state.activeBranchKey = null;
        resetBranchScopedState();
        state.branches = [];
        await ensureEventSubscription({ force: true });
        await refreshAll({ quiet: true });
        return;
      }

      const missingMethods = missingRequiredMethods();
      if (missingMethods.length > 0) {
        setRuntimeIssue(
          'Runtime update required',
          `This desktop build requires a newer local runtime. Reinstall or restart 0ctx, then reopen the app. Missing methods: ${missingMethods.join(', ')}.`
        );
      } else {
        state.runtimeIssue = null;
      }

      renderChrome();
      renderRuntimeBanner();
    } catch (error) {
      if (!state.runtimeIssue) {
        setRuntimeIssue(
          'Runtime unavailable',
          'The desktop app could not reach the local daemon. Start or repair 0ctx, then reopen the app if the issue remains.'
        );
      }
      renderChrome();
      renderRuntimeBanner();
    }
  }

  async function pollEventSubscription() {
    if (!bridge || state.loading || eventPollInFlight || state.runtimeIssue) {
      return;
    }
    if (!state.subscriptionId) {
      try {
        await ensureEventSubscription();
      } catch {
        return;
      }
    }
    if (!state.subscriptionId) {
      return;
    }

    eventPollInFlight = true;
    try {
      const result = await invoke('poll_events', {
        subscriptionId: state.subscriptionId,
        afterSequence: state.lastSeq,
        limit: 100
      });
      const cursor = Number(result?.cursor || state.lastSeq) || state.lastSeq;
      const events = Array.isArray(result?.events) ? result.events : [];
      if (cursor > state.lastSeq) {
        state.lastSeq = cursor;
        try {
          await invoke('ack_event', {
            subscriptionId: state.subscriptionId,
            sequence: cursor
          });
        } catch {
          // The app can continue using the local cursor even if explicit ack fails.
        }
      }
      if (hasRelevantMutation(events)) {
        await refreshAll({ quiet: true });
      }
    } catch (error) {
      const message = String(error || '');
      if (
        message.includes('Subscription')
        || message.includes('not found')
        || message.includes('No event subscription')
      ) {
        state.subscriptionId = null;
        state.subscriptionContextId = null;
        state.lastSeq = 0;
        try {
          await ensureEventSubscription({ force: true });
        } catch {
          // Leave recovery to the next poll or manual refresh.
        }
      }
    } finally {
      eventPollInFlight = false;
    }
  }

  function startBackgroundRefreshLoops() {
    if (!eventPollTimer) {
      eventPollTimer = setInterval(() => {
        void pollEventSubscription();
      }, EVENT_POLL_MS);
    }
    if (!healthRefreshTimer) {
      healthRefreshTimer = setInterval(() => {
        void refreshRuntimeHealth();
      }, HEALTH_REFRESH_MS);
    }
  }

  async function invoke(command, payload = {}) {
    if (!bridge) {
      throw new Error('Tauri bridge unavailable. Start the desktop app with npm run dev.');
    }
    return bridge(command, payload);
  }

  async function daemon(method, params = {}) {
    return invoke('daemon_call', { method, params });
  }

  async function requestDaemonStatus(retries = 2) {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await invoke('daemon_status', {});
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          await delay(350 * (attempt + 1));
        }
      }
    }
    throw lastError;
  }

  Object.assign(app, { setRuntimeIssue, hasRelevantMutation, clearEventSubscription, ensureEventSubscription, refreshRuntimeHealth, pollEventSubscription, startBackgroundRefreshLoops, invoke, daemon, requestDaemonStatus });
})();
