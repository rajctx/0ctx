export const LOGS_UI_STYLES_DETAIL = `.kv-section { margin-bottom: 20px; }
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
}`;
