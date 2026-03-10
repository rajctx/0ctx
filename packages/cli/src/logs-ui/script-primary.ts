export const LOGS_UI_SCRIPT_PRIMARY = `(function() {
  const PORT = __PORT__;
  const api = (path) => fetch('http://127.0.0.1:' + PORT + path).then(r => r.json()).catch(() => null);

  let paused = false;
  let activityFilter = 'all';
  let allOpsEntries = [];
  let allTimelineEntries = [];
  let allAuditEntries = [];
  let selectedRow = null;

  const TITLES = {
    activity: 'ACTIVITY LOG',
    timeline: 'TIMELINE',
    audit: 'AUDIT TRAIL',
    connector: 'CONNECTOR STATE',
    queue: 'EVENT QUEUE',
    daemon: 'DAEMON HEALTH'
  };

  function switchView(name) {
    document.querySelectorAll('#view-port > div').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-' + name).classList.remove('hidden');
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    const btn = Array.from(document.querySelectorAll('nav button'))
      .find(b => b.getAttribute('onclick') && b.getAttribute('onclick').includes(name));
    if (btn) btn.classList.add('active');
    document.getElementById('page-title').textContent = TITLES[name];
    closeDetail();
  }

  function fmtTs(ms) {
    if (!ms) return '--';
    const d = new Date(ms);
    return d.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  function fmtAgo(ms) {
    if (!ms) return '--';
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    return Math.floor(s / 3600) + 'h ago';
  }

  function fmtUptime(ms) {
    if (!ms && ms !== 0) return '--';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return d + 'd ' + (h % 24) + 'h';
    if (h > 0) return h + 'h ' + (m % 60) + 'm';
    if (m > 0) return m + 'm ' + (s % 60) + 's';
    return s + 's';
  }

  function escape(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function statusAccent(status) {
    if (status === 'success') return 'var(--status-green)';
    if (status === 'error')   return 'var(--status-red)';
    if (status === 'partial') return 'var(--status-amber)';
    return 'var(--status-blue)';
  }

  function filterActivity(f, el) {
    activityFilter = f;
    document.querySelectorAll('.toolbar .btn:not(.action)').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    renderActivityRows();
  }

  function renderActivityRows() {
    const entries = activityFilter === 'all'
      ? allOpsEntries
      : allOpsEntries.filter(e => e.status === activityFilter);

    const tbody = document.getElementById('activity-body');
    if (entries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">No entries found.<br>Run some <code>0ctx</code> commands to see activity here.</div></td></tr>';
      return;
    }

    tbody.innerHTML = entries.map((e, i) => {
      const cls = 'type-' + (e.status || 'event');
      const detailPreview = e.details && Object.keys(e.details).length > 0
        ? JSON.stringify(e.details).slice(0, 80) + (JSON.stringify(e.details).length > 80 ? '…' : '')
        : '--';
      return '<tr class="' + cls + '" onclick="openActivityDetail(' + i + ')">' +
        '<td></td>' +
        '<td class="dim">' + escape(fmtTs(e.timestamp)) + '</td>' +
        '<td>' + escape(e.operation) + '</td>' +
        '<td><span class="badge ' + (e.status === 'success' ? 'green' : e.status === 'error' ? 'red' : e.status === 'partial' ? 'amber' : 'blue') + '">' + escape(e.status) + '</span></td>' +
        '<td class="dim" style="font-size:11px">' + escape(detailPreview) + '</td>' +
        '</tr>';
    }).join('');
  }

  function openActivityDetail(idx) {
    const filtered = activityFilter === 'all'
      ? allOpsEntries
      : allOpsEntries.filter(e => e.status === activityFilter);
    const e = filtered[idx];
    if (!e) return;

    const accent = statusAccent(e.status);
    document.getElementById('detail-accent-bar').style.background = accent;
    document.getElementById('dp-type').textContent = e.operation;
    document.getElementById('dp-type').style.color = accent;
    document.getElementById('dp-sub').textContent = new Date(e.timestamp).toISOString();
    document.getElementById('dp-ts').textContent = new Date(e.timestamp).toISOString();
    document.getElementById('dp-op').textContent = e.operation;
    document.getElementById('dp-status').textContent = e.status;
    document.getElementById('dp-status').style.color = accent;
    document.getElementById('dp-payload').textContent = JSON.stringify(e.details ?? {}, null, 2);

    document.querySelectorAll('#activity-body tr').forEach((r, i) => r.classList.toggle('row-selected', i === idx));
    document.getElementById('detail-panel').classList.add('open');
    document.getElementById('overlay').classList.add('open');
  }

  async function refreshActivity() {
    if (paused) return;
    const data = await api('/api/ops');
    if (!data) return;
    allOpsEntries = data.entries || [];
    renderActivityRows();
  }

  function togglePause() {
    paused = !paused;
    document.getElementById('btn-pause').textContent = paused ? '> RESUME' : '|| PAUSE';
    document.getElementById('btn-pause').classList.toggle('action', !paused);
  }

  function renderTimelineRows() {
    const tbody = document.getElementById('timeline-body');
    if (allTimelineEntries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state">No timeline entries yet.</div></td></tr>';
      return;
    }

    tbody.innerHTML = allTimelineEntries.map((e, i) => {
      const status = e.status || 'event';
      const cls = 'type-' + (status === 'success' ? 'success' : status === 'error' ? 'error' : status === 'partial' ? 'partial' : 'event');
      const detailPreview = e.details && typeof e.details === 'object'
        ? JSON.stringify(e.details).slice(0, 90) + (JSON.stringify(e.details).length > 90 ? '…' : '')
        : '--';
      return '<tr class="' + cls + '" onclick="openTimelineDetail(' + i + ')">' +
        '<td></td>' +
        '<td class="dim">' + escape(fmtTs(e.timestamp)) + '</td>' +
        '<td>' + escape(e.kind || '--') + '</td>' +
        '<td>' + escape(e.title || '--') + '</td>' +
        '<td><span class="badge ' + (status === 'success' ? 'green' : status === 'error' ? 'red' : status === 'partial' ? 'amber' : 'gray') + '">' + escape(status) + '</span></td>' +
        '<td class="dim" style="font-size:11px">' + escape(detailPreview) + '</td>' +
        '</tr>';
    }).join('');
  }

  function openTimelineDetail(idx) {
    const e = allTimelineEntries[idx];
    if (!e) return;

    const accent = statusAccent(e.status);
    document.getElementById('detail-accent-bar').style.background = accent;
    document.getElementById('dp-type').textContent = (e.kind || 'timeline') + '.' + (e.title || 'event');
    document.getElementById('dp-type').style.color = accent;
    document.getElementById('dp-sub').textContent = e.timestamp ? new Date(e.timestamp).toISOString() : '--';
    document.getElementById('dp-ts').textContent = e.timestamp ? new Date(e.timestamp).toISOString() : '--';
    document.getElementById('dp-op').textContent = e.title || '--';
    document.getElementById('dp-status').textContent = e.status || 'event';
    document.getElementById('dp-status').style.color = accent;
    document.getElementById('dp-payload').textContent = JSON.stringify(e.details ?? {}, null, 2);

    document.querySelectorAll('#timeline-body tr').forEach((r, i) => r.classList.toggle('row-selected', i === idx));
    document.getElementById('detail-panel').classList.add('open');
    document.getElementById('overlay').classList.add('open');
  }

  async function refreshTimeline() {
    const data = await api('/api/timeline?limit=250');
    if (!data) return;
    allTimelineEntries = data.entries || [];
    renderTimelineRows();
  }

  function targetIdFromAudit(entry) {
    if (!entry || typeof entry !== 'object') return '--';
    const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
    const result = entry.result && typeof entry.result === 'object' ? entry.result : {};
    return payload.id || payload.nodeId || payload.contextId || result.id || result.contextId || '--';
  }

  function auditActionClass(action) {
    if (!action) return 'type-event';
    if (String(action).startsWith('delete_')) return 'type-error';
    if (String(action).startsWith('update_')) return 'type-partial';
    if (String(action).startsWith('create_') || String(action).startsWith('add_') || String(action) === 'save_checkpoint') return 'type-success';
    return 'type-event';
  }

  function renderAuditRows() {
    const tbody = document.getElementById('audit-body');
    if (allAuditEntries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">No audit events yet.<br>Create or update data to populate history.</div></td></tr>';
      return;
    }

    tbody.innerHTML = allAuditEntries.map((e, i) => {
      const cls = auditActionClass(e.action);
      return '<tr class="' + cls + '" onclick="openAuditDetail(' + i + ')">' +
        '<td></td>' +
        '<td class="dim">' + escape(fmtTs(e.createdAt)) + '</td>' +
        '<td>' + escape(e.action || '--') + '</td>' +
        '<td class="dim">' + escape(e.contextId || '--') + '</td>' +
        '<td class="dim">' + escape(e.actor || '--') + '</td>' +
        '<td class="dim">' + escape(e.source || '--') + '</td>' +
        '<td class="dim">' + escape(targetIdFromAudit(e)) + '</td>' +
        '</tr>';
    }).join('');
  }

  function openAuditDetail(idx) {
    const e = allAuditEntries[idx];
    if (!e) return;

    document.getElementById('detail-accent-bar').style.background = 'var(--status-blue)';
    document.getElementById('dp-type').textContent = 'audit.' + (e.action || 'event');
    document.getElementById('dp-type').style.color = 'var(--status-blue)';
    document.getElementById('dp-sub').textContent = e.createdAt ? new Date(e.createdAt).toISOString() : '--';
    document.getElementById('dp-ts').textContent = e.createdAt ? new Date(e.createdAt).toISOString() : '--';
    document.getElementById('dp-op').textContent = e.action || '--';
    document.getElementById('dp-status').textContent = e.source || 'daemon';
    document.getElementById('dp-status').style.color = 'var(--status-blue)';
    document.getElementById('dp-payload').textContent = JSON.stringify(e, null, 2);

    document.querySelectorAll('#audit-body tr').forEach((r, i) => r.classList.toggle('row-selected', i === idx));
    document.getElementById('detail-panel').classList.add('open');
    document.getElementById('overlay').classList.add('open');
  }

  async function refreshAudit() {
    const data = await api('/api/audit?limit=200');
    if (!data) return;
    allAuditEntries = data.entries || [];
    renderAuditRows();
  }`;
