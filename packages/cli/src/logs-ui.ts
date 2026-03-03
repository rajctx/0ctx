/**
 * Self-contained terminal-aesthetic HTML UI for `0ctx logs`.
 * Served by logs-server.ts over localhost. No external deps — pure HTML/CSS/JS.
 */
export function getLogsHtml(port: number): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>0CTX // LOCAL LOGS</title>
<style>
:root {
    --bg-color: #030303;
    --text-primary: #e0e0e0;
    --text-secondary: #999999;
    --text-dim: #666666;
    --accent-red: #8a1c1c;
    --accent-pink: #d44c9c;
    --accent-white: #ffffff;
    --status-blue: #4d94ff;
    --status-green: #00ff41;
    --status-red: #ff3333;
    --status-amber: #ffb84d;
    --status-gray: #888888;
    --border-style: 1px solid #222;
    --font-stack: "Courier New", Courier, monospace;
}
* { box-sizing: border-box; -webkit-font-smoothing: none; margin: 0; padding: 0; }
body {
    background-color: var(--bg-color);
    color: var(--text-primary);
    font-family: var(--font-stack);
    height: 100vh;
    overflow: hidden;
    display: flex;
    font-size: 13px;
    line-height: 1.4;
}
::-webkit-scrollbar { width: 8px; height: 8px; background: #000; }
::-webkit-scrollbar-thumb { background: var(--accent-red); }

#app-container { display: grid; grid-template-columns: 240px 1fr; width: 100%; height: 100%; }

aside {
    border-right: var(--border-style);
    display: flex;
    flex-direction: column;
    padding: 20px 0;
    position: relative;
    background: #000;
    z-index: 10;
}
.decor-line { position: absolute; top: 0; bottom: 0; width: 1px; pointer-events: none; opacity: 0.6; }
.decor-line.pink { left: 12px; background: var(--accent-pink); }
.decor-line.red  { left: 16px; background: var(--accent-red); }

.brand {
    padding: 0 24px 20px 32px;
    font-weight: bold;
    letter-spacing: 1px;
    border-bottom: var(--border-style);
    margin-bottom: 20px;
    color: var(--accent-white);
    text-transform: uppercase;
}
.brand .local-badge {
    display: inline-block;
    font-size: 9px;
    color: var(--status-amber);
    border: 1px solid var(--status-amber);
    padding: 1px 5px;
    margin-top: 6px;
    letter-spacing: 0.5px;
}

nav button {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-family: var(--font-stack);
    font-size: 12px;
    text-align: left;
    padding: 8px 24px 8px 32px;
    cursor: pointer;
    width: 100%;
    display: flex;
    justify-content: space-between;
    text-transform: uppercase;
    position: relative;
}
nav button:hover { color: var(--accent-white); background: #111; }
nav button.active { color: var(--accent-pink); background: #0a0a0a; }
nav button.active::before { content: '>'; position: absolute; left: 20px; color: var(--accent-pink); }
nav button span.code { color: var(--text-dim); font-size: 10px; }

.status-footer {
    margin-top: auto;
    padding: 12px 32px;
    color: var(--text-dim);
    font-size: 10px;
    border-top: var(--border-style);
    line-height: 1.8;
}
.status-footer .up   { color: var(--status-green); }
.status-footer .down { color: var(--status-red); }
.status-footer .warn { color: var(--status-amber); }

main { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
header {
    height: 48px;
    border-bottom: var(--border-style);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    flex-shrink: 0;
}
#page-title { text-transform: uppercase; font-weight: bold; }
#header-meta { color: var(--text-dim); font-size: 11px; }
.header-badge {
    display: inline-block;
    border: 1px solid var(--status-amber);
    color: var(--status-amber);
    font-size: 10px;
    padding: 1px 6px;
    margin-right: 12px;
}

#view-port { flex: 1; overflow: auto; padding: 24px; position: relative; }

/* Tables */
.data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.data-table th {
    text-align: left;
    border-bottom: 1px solid var(--text-dim);
    padding: 8px 12px;
    color: var(--text-secondary);
    font-weight: normal;
    text-transform: uppercase;
    font-size: 11px;
}
.data-table td { padding: 6px 12px; border-bottom: 1px solid #111; vertical-align: top; }
.data-table tbody tr:hover { background: #080808; }
.data-table tbody tr { cursor: pointer; }
.data-table tbody tr.row-selected { background: #0c0c0c; outline: 1px solid #2a2a2a; }

/* Row type colors */
tr.type-success  { border-left: 2px solid var(--status-green); }
tr.type-error    { border-left: 2px solid var(--status-red); }
tr.type-partial  { border-left: 2px solid var(--status-amber); }
tr.type-dry_run  { border-left: 2px solid var(--status-blue); }
tr.type-event    { border-left: 2px solid var(--status-gray); }
tr.type-backoff  { border-left: 2px solid var(--status-amber); }

.dim { color: var(--text-dim); }

/* Badges */
.badge {
    display: inline-block;
    padding: 1px 6px;
    border: 1px solid currentColor;
    font-size: 10px;
    text-transform: uppercase;
}
.badge.green  { color: var(--status-green); }
.badge.red    { color: var(--status-red); }
.badge.amber  { color: var(--status-amber); }
.badge.blue   { color: var(--status-blue); }
.badge.gray   { color: var(--status-gray); }

/* Toolbar */
.toolbar {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
    padding-bottom: 16px;
    border-bottom: 1px dashed #222;
    align-items: center;
}
.btn {
    background: #000;
    border: 1px solid var(--text-dim);
    color: var(--text-primary);
    padding: 4px 12px;
    font-family: var(--font-stack);
    font-size: 11px;
    text-transform: uppercase;
    cursor: pointer;
}
.btn:hover { border-color: var(--accent-white); }
.btn.active { background: #222; color: var(--accent-white); border-color: var(--accent-white); }
.btn.action { border-color: var(--accent-pink); color: var(--accent-pink); }

/* Stats bar */
.stats-bar {
    display: flex;
    gap: 20px;
    font-size: 11px;
    color: var(--text-dim);
    padding: 8px 0;
}
.stats-bar b { font-weight: normal; }

/* Cards (daemon view) */
.grid-dashboard { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
.card { border: 1px solid #222; padding: 16px; position: relative; }
.card::before { content: ''; position: absolute; top: -1px; left: 10px; width: 20px; height: 1px; background: var(--accent-pink); }
.card h3 { margin: 0 0 14px 0; font-size: 11px; text-transform: uppercase; color: var(--text-secondary); }
.card .stat-val { font-size: 22px; color: var(--accent-white); margin-bottom: 4px; }
.card .stat-sub { font-size: 10px; color: var(--text-dim); }

/* KV table (connector view) */
.kv-section { margin-bottom: 20px; }
.kv-label {
    font-size: 10px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid #181818;
}
.kv-row {
    display: flex;
    justify-content: space-between;
    padding: 5px 0;
    font-size: 12px;
    border-bottom: 1px dotted #111;
    gap: 12px;
}
.kv-key { color: var(--text-dim); flex-shrink: 0; }
.kv-val { color: var(--text-primary); text-align: right; word-break: break-all; max-width: 360px; }
.kv-val.green { color: var(--status-green); }
.kv-val.red   { color: var(--status-red); }
.kv-val.amber { color: var(--status-amber); }
.kv-val.dim   { color: var(--text-dim); }

/* Empty state */
.empty-state {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 2;
}
.empty-state code {
    display: inline-block;
    background: #111;
    padding: 2px 8px;
    border: 1px solid #333;
    color: var(--text-secondary);
    font-family: var(--font-stack);
}

/* Detail Panel */
.overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 99; }
.overlay.open { display: block; }
.detail-panel {
    position: fixed;
    top: 0; right: -520px;
    width: 520px; height: 100vh;
    background: #050505;
    border-left: 1px solid #2a2a2a;
    z-index: 100;
    display: flex;
    flex-direction: column;
    transition: right 0.22s cubic-bezier(.4,0,.2,1);
}
.detail-panel.open { right: 0; }
.detail-accent-bar { position: absolute; left: 0; top: 0; bottom: 0; width: 2px; }
.detail-panel-header {
    padding: 16px 20px 14px 24px;
    border-bottom: 1px solid #1e1e1e;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-shrink: 0;
}
.detail-panel-type { font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
.detail-panel-sub { font-size: 10px; color: var(--text-dim); margin-top: 5px; }
.detail-close {
    background: transparent;
    border: 1px solid #333;
    color: var(--text-secondary);
    font-family: var(--font-stack);
    font-size: 11px;
    cursor: pointer;
    padding: 3px 10px;
    letter-spacing: 1px;
}
.detail-close:hover { border-color: #fff; color: #fff; }
.detail-body { flex: 1; overflow-y: auto; padding: 20px 24px; }
.detail-section { margin-bottom: 20px; }
.detail-section-label {
    font-size: 10px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid #181818;
}
.detail-kv { display: flex; justify-content: space-between; padding: 5px 0; font-size: 12px; border-bottom: 1px dotted #121212; gap: 12px; }
.detail-kv-key { color: var(--text-dim); flex-shrink: 0; }
.detail-kv-val { color: var(--text-primary); text-align: right; word-break: break-all; }
.detail-payload {
    background: #080808;
    border: 1px solid #1a1a1a;
    padding: 12px 14px;
    font-size: 11px;
    line-height: 1.65;
    white-space: pre;
    overflow-x: auto;
    color: var(--text-secondary);
}

.hidden { display: none; }

@keyframes blink { 50% { opacity: 0; } }
.cursor {
    display: inline-block; width: 8px; height: 13px;
    background: var(--accent-pink);
    animation: blink 1s step-end infinite;
    vertical-align: middle;
}
</style>
</head>
<body>
<div id="app-container">
  <aside>
    <div class="decor-line pink"></div>
    <div class="decor-line red"></div>
    <div class="brand">
      0CTX_LOGS<br>
      <span class="local-badge">LOCAL MODE // NO AUTH</span>
    </div>
    <nav>
      <button class="active" onclick="switchView('activity')">Activity Log <span class="code">01</span></button>
      <button onclick="switchView('audit')">Audit Trail <span class="code">02</span></button>
      <button onclick="switchView('connector')">Connector State <span class="code">03</span></button>
      <button onclick="switchView('queue')">Event Queue <span class="code">04</span></button>
      <button onclick="switchView('daemon')">Daemon Health <span class="code">05</span></button>
    </nav>
    <div class="status-footer" id="status-footer">
      &gt; DAEMON: <span id="sf-daemon" class="dim">...</span><br>
      &gt; QUEUE: <span id="sf-queue" class="dim">...</span><br>
      &gt; REFRESH: <span id="sf-ts" class="dim">--</span>
    </div>
  </aside>

  <main>
    <header>
      <div id="page-title">ACTIVITY LOG</div>
      <div id="header-meta">
        <span class="header-badge">LOCAL</span>
        <span style="color:var(--text-dim); font-size:11px;">PORT: ${port} &nbsp;//&nbsp; <span id="hdr-ts">--</span></span>
      </div>
    </header>
    <div id="view-port">

      <!-- ACTIVITY VIEW -->
      <div id="view-activity">
        <div class="toolbar">
          <button class="btn action" id="btn-pause" onclick="togglePause()">|| PAUSE</button>
          <div style="flex:1"></div>
          <button class="btn active" onclick="filterActivity('all',this)">ALL</button>
          <button class="btn" onclick="filterActivity('error',this)">ERRORS</button>
          <button class="btn" onclick="filterActivity('success',this)">SUCCESS</button>
        </div>
        <table class="data-table" id="activity-table">
          <thead><tr>
            <th width="8"></th>
            <th>TIMESTAMP</th>
            <th>OPERATION</th>
            <th>STATUS</th>
            <th>DETAILS</th>
          </tr></thead>
          <tbody id="activity-body">
            <tr><td colspan="5"><div class="empty-state">Loading...<span class="cursor"></span></div></td></tr>
          </tbody>
        </table>
      </div>

      <!-- AUDIT VIEW -->
      <div id="view-audit" class="hidden">
        <table class="data-table" id="audit-table">
          <thead><tr>
            <th width="8"></th>
            <th>TIMESTAMP</th>
            <th>ACTION</th>
            <th>CONTEXT</th>
            <th>ACTOR</th>
            <th>SOURCE</th>
            <th>TARGET</th>
          </tr></thead>
          <tbody id="audit-body">
            <tr><td colspan="7"><div class="empty-state">Loading audit history...<span class="cursor"></span></div></td></tr>
          </tbody>
        </table>
      </div>

      <!-- CONNECTOR VIEW -->
      <div id="view-connector" class="hidden">
        <div id="connector-content">
          <div class="empty-state">Loading connector state...<span class="cursor"></span></div>
        </div>
      </div>

      <!-- QUEUE VIEW -->
      <div id="view-queue" class="hidden">
        <div class="stats-bar" id="queue-stats-bar">
          <span>PENDING: <b id="qs-pending" style="color:white">--</b></span>
          <span>READY: <b id="qs-ready" style="color:var(--status-green)">--</b></span>
          <span>BACKOFF: <b id="qs-backoff" style="color:var(--status-amber)">--</b></span>
          <span>MAX_ATTEMPTS: <b id="qs-max" style="color:var(--text-secondary)">--</b></span>
        </div>
        <table class="data-table" id="queue-table">
          <thead><tr>
            <th width="8"></th>
            <th>EVENT TYPE</th>
            <th>SOURCE</th>
            <th>SEQ</th>
            <th>ATTEMPTS</th>
            <th>NEXT RETRY</th>
            <th>ERROR</th>
          </tr></thead>
          <tbody id="queue-body">
            <tr><td colspan="7"><div class="empty-state">Loading queue...<span class="cursor"></span></div></td></tr>
          </tbody>
        </table>
      </div>

      <!-- DAEMON VIEW -->
      <div id="view-daemon" class="hidden">
        <div class="grid-dashboard" id="daemon-content">
          <div class="empty-state" style="grid-column:1/-1">Querying daemon...<span class="cursor"></span></div>
        </div>
      </div>

    </div><!-- /view-port -->
  </main>
</div>

<!-- Detail Panel -->
<div class="overlay" id="overlay" onclick="closeDetail()"></div>
<div class="detail-panel" id="detail-panel">
  <div class="detail-accent-bar" id="detail-accent-bar"></div>
  <div class="detail-panel-header">
    <div>
      <div class="detail-panel-type" id="dp-type">--</div>
      <div class="detail-panel-sub" id="dp-sub">--</div>
    </div>
    <button class="detail-close" onclick="closeDetail()">[ESC]</button>
  </div>
  <div class="detail-body">
    <div class="detail-section">
      <div class="detail-section-label">Entry</div>
      <div class="detail-kv"><span class="detail-kv-key">Timestamp</span><span class="detail-kv-val" id="dp-ts">--</span></div>
      <div class="detail-kv"><span class="detail-kv-key">Operation</span><span class="detail-kv-val" id="dp-op">--</span></div>
      <div class="detail-kv"><span class="detail-kv-key">Status</span><span class="detail-kv-val" id="dp-status">--</span></div>
    </div>
    <div class="detail-section">
      <div class="detail-section-label">Details</div>
      <div class="detail-payload" id="dp-payload">{}</div>
    </div>
  </div>
</div>

<script>
(function() {
  const PORT = ${port};
  const api = (path) => fetch('http://127.0.0.1:' + PORT + path).then(r => r.json()).catch(() => null);

  let paused = false;
  let activityFilter = 'all';
  let allOpsEntries = [];
  let allAuditEntries = [];
  let selectedRow = null;

  // ─── View switching ───────────────────────────────────────────────────────

  const TITLES = {
    activity: 'ACTIVITY LOG',
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

  // ─── Formatting helpers ──────────────────────────────────────────────────

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

  // ─── Activity view ───────────────────────────────────────────────────────

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

  // ─── Audit view ──────────────────────────────────────────────────────────

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
  }

  // ─── Connector view ──────────────────────────────────────────────────────

  function kv(label, value, cls) {
    return '<div class="kv-row"><span class="kv-key">' + escape(label) + '</span><span class="kv-val ' + (cls || '') + '">' + escape(String(value ?? '--')) + '</span></div>';
  }

  function section(title, rows) {
    return '<div class="kv-section"><div class="kv-label">' + escape(title) + '</div>' + rows + '</div>';
  }

  async function refreshConnector() {
    const state = await api('/api/identity');
    const el = document.getElementById('connector-content');
    if (!state || state._missing) {
      el.innerHTML = '<div class="empty-state">No connector state found.<br>Run <code>0ctx connector register</code> to register this machine.</div>';
      return;
    }

    const registeredAt = state.registeredAt ? new Date(state.registeredAt).toISOString() : '--';
    const updatedAt = state.updatedAt ? new Date(state.updatedAt).toISOString() : '--';
    const lastHb = state.cloud?.lastHeartbeatAt ? fmtAgo(state.cloud.lastHeartbeatAt) : '--';

    el.innerHTML =
      section('Identity', [
        kv('Machine ID', state.machineId),
        kv('Tenant ID', state.tenantId ?? 'none', state.tenantId ? '' : 'dim'),
        kv('Mode', state.registrationMode),
        kv('Dashboard URL', state.uiUrl),
        kv('Registered', registeredAt, 'dim'),
        kv('Updated', updatedAt, 'dim'),
      ].join('')) +

      section('Cloud State', [
        kv('Registration ID', state.cloud?.registrationId ?? 'none', state.cloud?.registrationId ? '' : 'dim'),
        kv('Stream URL', state.cloud?.streamUrl ?? 'none', state.cloud?.streamUrl ? '' : 'dim'),
        kv('Last Heartbeat', lastHb, lastHb === '--' ? 'dim' : ''),
        kv('Last Error', state.cloud?.lastError ?? 'none', state.cloud?.lastError ? 'red' : 'dim'),
        kv('Capabilities', (state.cloud?.capabilities || []).join(', ') || 'none', 'dim'),
      ].join('')) +

      section('Runtime State', [
        kv('Last Event Sequence', state.runtime?.lastEventSequence ?? 0),
        kv('Last Event Sync', state.runtime?.lastEventSyncAt ? fmtAgo(state.runtime.lastEventSyncAt) : '--', 'dim'),
        kv('Event Queue Pending', state.runtime?.eventQueuePending ?? 0, state.runtime?.eventQueuePending > 0 ? 'amber' : ''),
        kv('Event Queue Ready', state.runtime?.eventQueueReady ?? 0, state.runtime?.eventQueueReady > 0 ? 'green' : ''),
        kv('Event Queue Backoff', state.runtime?.eventQueueBackoff ?? 0, state.runtime?.eventQueueBackoff > 0 ? 'red' : ''),
        kv('Event Bridge', state.runtime?.eventBridgeSupported ? 'supported' : 'not supported', state.runtime?.eventBridgeSupported ? 'green' : 'red'),
        kv('Event Bridge Error', state.runtime?.eventBridgeError ?? 'none', state.runtime?.eventBridgeError ? 'red' : 'dim'),
        kv('Last Command Cursor', state.runtime?.lastCommandCursor ?? 0),
        kv('Last Command Sync', state.runtime?.lastCommandSyncAt ? fmtAgo(state.runtime.lastCommandSyncAt) : '--', 'dim'),
        kv('Command Bridge', state.runtime?.commandBridgeSupported ? 'supported' : 'not supported', state.runtime?.commandBridgeSupported ? 'green' : 'red'),
        kv('Command Bridge Error', state.runtime?.commandBridgeError ?? 'none', state.runtime?.commandBridgeError ? 'red' : 'dim'),
      ].join(''));
  }

  // ─── Queue view ──────────────────────────────────────────────────────────

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

  // ─── Daemon view ─────────────────────────────────────────────────────────

  async function refreshDaemon() {
    const data = await api('/api/daemon');
    const el = document.getElementById('daemon-content');

    if (!data || !data.reachable) {
      el.innerHTML =
        '<div class="card" style="grid-column:1/-1">' +
        '<h3>Daemon Status</h3>' +
        '<div class="stat-val" style="color:var(--status-red)">OFFLINE</div>' +
        '<div class="stat-sub">Run <code>0ctx daemon start</code> to start the daemon.</div>' +
        '</div>';
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
      card('Authentication', '<div class="stat-val" style="color:' + (h.authenticated ? 'var(--status-green)' : 'var(--status-amber)') + '">' + (h.authenticated ? 'AUTHED' : 'ANON') + '</div><div class="stat-sub">Sub: ' + escape(h.sub || 'none') + '</div>') +
      card('Sync Engine',
        '<div class="stat-val" style="color:' + (s.running ? 'var(--status-green)' : 'var(--status-amber)') + '">' + (s.running ? 'RUNNING' : s.enabled ? 'IDLE' : 'DISABLED') + '</div>' +
        (s.lastError ? '<div class="stat-sub" style="color:var(--status-red)">' + escape(s.lastError) + '</div>' : '<div class="stat-sub">No errors</div>')
      ) +
      card('Capabilities', '<div class="stat-val">' + escape(methodCount) + '</div><div class="stat-sub">API v' + escape(c.apiVersion || '?') + ' &nbsp;·&nbsp; ' + escape((c.features || []).slice(0,3).join(', ') || 'none') + '</div>');

    document.getElementById('sf-daemon').textContent = 'UP';
    document.getElementById('sf-daemon').className = 'up';
  }

  function card(title, content) {
    return '<div class="card"><h3>' + escape(title) + '</h3>' + content + '</div>';
  }

  // ─── Status footer ───────────────────────────────────────────────────────

  async function refreshStatusFooter() {
    const [queueData, daemonData] = await Promise.all([
      api('/api/queue'),
      api('/api/daemon')
    ]);

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

  // ─── Detail panel ────────────────────────────────────────────────────────

  function closeDetail() {
    document.getElementById('detail-panel').classList.remove('open');
    document.getElementById('overlay').classList.remove('open');
    document.querySelectorAll('.row-selected').forEach(r => r.classList.remove('row-selected'));
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

  // ─── Poll loops ──────────────────────────────────────────────────────────

  function startPolling() {
    refreshActivity();
    refreshAudit();
    refreshConnector();
    refreshQueue();
    refreshDaemon();
    refreshStatusFooter();

    setInterval(refreshActivity, 3000);
    setInterval(refreshAudit, 4000);
    setInterval(() => { refreshConnector(); refreshQueue(); }, 5000);
    setInterval(() => { refreshDaemon(); refreshStatusFooter(); }, 6000);
  }

  // Expose globals
  window.switchView = switchView;
  window.togglePause = togglePause;
  window.filterActivity = filterActivity;
  window.openActivityDetail = openActivityDetail;
  window.openAuditDetail = openAuditDetail;
  window.openQueueDetail = openQueueDetail;
  window.closeDetail = closeDetail;

  startPolling();
})();
</script>
</body>
</html>`;
}
