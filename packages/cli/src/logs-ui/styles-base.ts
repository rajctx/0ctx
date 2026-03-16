export const LOGS_UI_STYLES_BASE = `:root {
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

tr.type-success  { border-left: 2px solid var(--status-green); }
tr.type-error    { border-left: 2px solid var(--status-red); }
tr.type-partial  { border-left: 2px solid var(--status-amber); }
tr.type-dry_run  { border-left: 2px solid var(--status-blue); }
tr.type-event    { border-left: 2px solid var(--status-gray); }
tr.type-backoff  { border-left: 2px solid var(--status-amber); }

.dim { color: var(--text-dim); }

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

.stats-bar {
    display: flex;
    gap: 20px;
    font-size: 11px;
    color: var(--text-dim);
    padding: 8px 0;
}
.stats-bar b { font-weight: normal; }

.grid-dashboard { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
.card { border: 1px solid #222; padding: 16px; position: relative; }
.card::before { content: ''; position: absolute; top: -1px; left: 10px; width: 20px; height: 1px; background: var(--accent-pink); }
.card h3 { margin: 0 0 14px 0; font-size: 11px; text-transform: uppercase; color: var(--text-secondary); }
.card .stat-val { font-size: 22px; color: var(--accent-white); margin-bottom: 4px; }
.card .stat-sub { font-size: 10px; color: var(--text-dim); }`;
