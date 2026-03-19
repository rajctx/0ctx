export const LOGS_UI_SCRIPT_SECONDARY = `  function kv(label, value, cls) {
    return '<div class="kv-row"><span class="kv-key">' + escape(label) + '</span><span class="kv-val ' + (cls || '') + '">' + escape(String(value ?? '--')) + '</span></div>';
  }

  function section(title, rows) {
    return '<div class="kv-section"><div class="kv-label">' + escape(title) + '</div>' + rows + '</div>';
  }

  async function refreshConnector() {
    const state = await api('/api/identity');
    const el = document.getElementById('connector-content');
    if (!state || state._missing) {
      el.innerHTML = '<div class="empty-state">No legacy connector state found.<br>New local-only installs do not require machine registration.</div>';
      return;
    }

    const registeredAt = state.registeredAt ? new Date(state.registeredAt).toISOString() : '--';
    const updatedAt = state.updatedAt ? new Date(state.updatedAt).toISOString() : '--';

    el.innerHTML =
      section('Legacy Identity', [
        kv('Machine ID', state.machineId),
        kv('UI URL', state.uiUrl),
        kv('Registered', registeredAt, 'dim'),
        kv('Updated', updatedAt, 'dim'),
      ].join('')) +
      section('Legacy Runtime State', [
        kv('Event Queue Pending', state.runtime?.eventQueuePending ?? 0, state.runtime?.eventQueuePending > 0 ? 'amber' : ''),
        kv('Event Queue Ready', state.runtime?.eventQueueReady ?? 0, state.runtime?.eventQueueReady > 0 ? 'green' : ''),
        kv('Event Queue Backoff', state.runtime?.eventQueueBackoff ?? 0, state.runtime?.eventQueueBackoff > 0 ? 'red' : ''),
        kv('Recovery State', state.runtime?.recoveryState ?? 'healthy'),
        kv('Consecutive Failures', state.runtime?.consecutiveFailures ?? 0),
        kv('Last Healthy', state.runtime?.lastHealthyAt ? fmtAgo(state.runtime.lastHealthyAt) : '--', 'dim'),
        kv('Last Recovery', state.runtime?.lastRecoveryAt ? fmtAgo(state.runtime.lastRecoveryAt) : '--', 'dim'),
      ].join(''));
  }

  let allQueueItems = [];

  async function refreshQueue() {
    const data = await api('/api/queue');
    if (!data) return;
    const stats = data.stats || {};
    document.getElementById('qs-pending').textContent = stats.pending ?? 0;
    document.getElementById('qs-ready').textContent = stats.ready ?? 0;
    document.getElementById('qs-backoff').textContent = stats.backoff ?? 0;
    document.getElementById('qs-max').textContent = stats.maxAttempts ?? 0;

    allQueueItems = data.items || [];
    const tbody = document.getElementById('queue-body');
    if (allQueueItems.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">Queue is empty. All events delivered successfully.</div></td></tr>';
      return;
    }

    const now = Date.now();
    tbody.innerHTML = allQueueItems.map((item, i) => {
      const inBackoff = item.nextAttemptAt > now && item.attempts > 0;
      const cls = item.lastError ? 'type-error' : inBackoff ? 'type-backoff' : 'type-event';
      const nextRetry = inBackoff ? fmtAgo(item.nextAttemptAt - (item.nextAttemptAt - now)) + ' in ' + Math.ceil((item.nextAttemptAt - now) / 1000) + 's' : 'now';
      return '<tr class="' + cls + '" onclick="openQueueDetail(' + i + ')">' +
        '<td></td>' +
        '<td>' + escape(item.type) + '</td>' +
        '<td class="dim">' + escape(item.source) + '</td>' +
        '<td class="dim">' + escape(item.sequence) + '</td>' +
        '<td>' + escape(item.attempts) + '</td>' +
        '<td class="dim">' + escape(nextRetry) + '</td>' +
        '<td style="font-size:11px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + escape(item.lastError ?? '--') + '</td>' +
        '</tr>';
    }).join('');
  }

  function openQueueDetail(idx) {
    const item = allQueueItems[idx];
    if (!item) return;

    const hasError = !!item.lastError;
    const accent = hasError ? 'var(--status-red)' : 'var(--status-gray)';
    document.getElementById('detail-accent-bar').style.background = accent;
    document.getElementById('dp-type').textContent = item.type;
    document.getElementById('dp-type').style.color = accent;
    document.getElementById('dp-sub').textContent = item.source + ' · seq ' + item.sequence;
    document.getElementById('dp-ts').textContent = item.timestamp ? new Date(item.timestamp).toISOString() : '--';
    document.getElementById('dp-op').textContent = 'queueId: ' + item.queueId;
    document.getElementById('dp-status').textContent = hasError ? 'failed (' + item.attempts + ' attempts)' : 'pending';
    document.getElementById('dp-status').style.color = accent;
    document.getElementById('dp-payload').textContent = JSON.stringify({
      eventId: item.eventId,
      subscriptionId: item.subscriptionId,
      contextId: item.contextId,
      enqueuedAt: item.enqueuedAt ? new Date(item.enqueuedAt).toISOString() : null,
      nextAttemptAt: item.nextAttemptAt ? new Date(item.nextAttemptAt).toISOString() : null,
      lastError: item.lastError,
      payload: item.payload
    }, null, 2);

    document.querySelectorAll('#queue-body tr').forEach((r, i) => r.classList.toggle('row-selected', i === idx));
    document.getElementById('detail-panel').classList.add('open');
    document.getElementById('overlay').classList.add('open');
  }

  async function refreshDaemon() {
    const data = await api('/api/daemon');
    const el = document.getElementById('daemon-content');
    if (!data || !data.reachable) {
      el.innerHTML =
        '<div class="card" style="grid-column:1/-1"><h3>Daemon Status</h3><div class="stat-val" style="color:var(--status-red)">OFFLINE</div><div class="stat-sub">Run <code>0ctx daemon start</code> to start the daemon.</div></div>';
      document.getElementById('sf-daemon').textContent = 'DOWN';
      document.getElementById('sf-daemon').className = 'down';
      return;
    }

    const h = data.health || {};
    const s = data.sync || {};
    const c = data.capabilities || {};
    const methodCount = Array.isArray(c.methods) ? c.methods.length : '--';
    const uptime = h.uptimeMs !== undefined ? fmtUptime(h.uptimeMs) : '--';

    el.innerHTML =
      card('Daemon Status', '<div class="stat-val" style="color:var(--status-green)">ONLINE</div><div class="stat-sub">Uptime: ' + escape(uptime) + '</div>') +
      card('Sync Engine', '<div class="stat-val" style="color:' + (s.running ? 'var(--status-green)' : 'var(--status-amber)') + '">' + (s.running ? 'RUNNING' : s.enabled ? 'IDLE' : 'LOCAL ONLY') + '</div>' + (s.lastError ? '<div class="stat-sub" style="color:var(--status-red)">' + escape(s.lastError) + '</div>' : '<div class="stat-sub">No errors</div>')) +
      card('Capabilities', '<div class="stat-val">' + escape(methodCount) + '</div><div class="stat-sub">API v' + escape(c.apiVersion || '?') + ' &nbsp;·&nbsp; ' + escape((c.features || []).slice(0,3).join(', ') || 'none') + '</div>');

    document.getElementById('sf-daemon').textContent = 'UP';
    document.getElementById('sf-daemon').className = 'up';
  }

  function card(title, content) {
    return '<div class="card"><h3>' + escape(title) + '</h3>' + content + '</div>';
  }

  async function refreshStatusFooter() {
    const [queueData, daemonData] = await Promise.all([api('/api/queue'), api('/api/daemon')]);
    const pending = queueData?.stats?.pending ?? '?';
    document.getElementById('sf-queue').textContent = pending + ' pending';
    document.getElementById('sf-queue').className = pending > 0 ? 'warn' : '';

    const now = new Date().toLocaleTimeString('en-US', { hour12: false });
    document.getElementById('sf-ts').textContent = now;
    document.getElementById('hdr-ts').textContent = now;

    if (!daemonData || !daemonData.reachable) {
      document.getElementById('sf-daemon').textContent = 'DOWN';
      document.getElementById('sf-daemon').className = 'down';
    }
  }

  function closeDetail() {
    document.getElementById('detail-panel').classList.remove('open');
    document.getElementById('overlay').classList.remove('open');
    document.querySelectorAll('.row-selected').forEach(r => r.classList.remove('row-selected'));
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

  function startPolling() {
    refreshActivity();
    refreshTimeline();
    refreshAudit();
    refreshConnector();
    refreshQueue();
    refreshDaemon();
    refreshStatusFooter();
    setInterval(refreshActivity, 3000);
    setInterval(refreshTimeline, 3500);
    setInterval(refreshAudit, 4000);
    setInterval(() => { refreshConnector(); refreshQueue(); }, 5000);
    setInterval(() => { refreshDaemon(); refreshStatusFooter(); }, 6000);
  }

  window.switchView = switchView;
  window.togglePause = togglePause;
  window.filterActivity = filterActivity;
  window.openActivityDetail = openActivityDetail;
  window.openTimelineDetail = openTimelineDetail;
  window.openAuditDetail = openAuditDetail;
  window.openQueueDetail = openQueueDetail;
  window.closeDetail = closeDetail;

  startPolling();
})();`;
