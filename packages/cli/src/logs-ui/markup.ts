export function getLogsUiMarkup(port: number): string {
    return `<body>
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
      <button onclick="switchView('timeline')">Timeline <span class="code">02</span></button>
      <button onclick="switchView('audit')">Audit Trail <span class="code">03</span></button>
      <button onclick="switchView('connector')">Connector State <span class="code">04</span></button>
      <button onclick="switchView('queue')">Event Queue <span class="code">05</span></button>
      <button onclick="switchView('daemon')">Daemon Health <span class="code">06</span></button>
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

      <div id="view-timeline" class="hidden">
        <table class="data-table" id="timeline-table">
          <thead><tr>
            <th width="8"></th>
            <th>TIMESTAMP</th>
            <th>KIND</th>
            <th>TITLE</th>
            <th>STATUS</th>
            <th>DETAILS</th>
          </tr></thead>
          <tbody id="timeline-body">
            <tr><td colspan="6"><div class="empty-state">Loading timeline...<span class="cursor"></span></div></td></tr>
          </tbody>
        </table>
      </div>

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

      <div id="view-connector" class="hidden">
        <div id="connector-content">
          <div class="empty-state">Loading connector state...<span class="cursor"></span></div>
        </div>
      </div>

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

      <div id="view-daemon" class="hidden">
        <div class="grid-dashboard" id="daemon-content">
          <div class="empty-state" style="grid-column:1/-1">Querying daemon...<span class="cursor"></span></div>
        </div>
      </div>
    </div>
  </main>
</div>

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
</div>`;
}
