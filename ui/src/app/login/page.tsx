/**
 * /login — Entry point for web authentication.
 *
 * Renders a branded page with a single sign-in button that links to
 * /auth/login (Auth0 SDK v4 managed route). Auth0 Universal Login
 * handles the actual authentication — no custom credential handling here.
 */
import Link from 'next/link';

export default function LoginPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
          :root {
            --bg: #030303;
            --panel: #0a0a0a;
            --border: #1e1e1e;
            --text: #e5e5e5;
            --muted: #9a9a9a;
            --accent: #f97316;
            --accent-dim: rgba(249,115,22,0.12);
            --font-mono: 'SF Mono','Segoe UI Mono','Fira Code','Roboto Mono',monospace;
          }

          .page {
            background: var(--bg);
            color: var(--text);
            font-family: var(--font-mono);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
          }

          .card {
            border: 1px solid var(--border);
            background: var(--panel);
            width: 100%;
            max-width: 400px;
            padding: 36px 32px 32px;
          }

          .header {
            border-bottom: 1px solid var(--border);
            padding-bottom: 16px;
            margin-bottom: 28px;
          }

          .label {
            font-size: 11px;
            color: var(--muted);
            letter-spacing: 0.1em;
            text-transform: uppercase;
            margin-bottom: 6px;
          }

          .brand {
            font-size: 22px;
            font-weight: 600;
            color: var(--text);
            letter-spacing: -0.02em;
          }

          .brand span {
            color: var(--accent);
          }

          .tagline {
            font-size: 12px;
            color: var(--muted);
            margin-top: 4px;
          }

          .btn {
            display: flex;
            align-items: center;
            gap: 10px;
            width: 100%;
            padding: 12px 16px;
            background: var(--accent-dim);
            border: 1px solid var(--accent);
            color: var(--accent);
            font-family: var(--font-mono);
            font-size: 13px;
            cursor: pointer;
            text-decoration: none;
            transition: background 0.15s ease;
          }

          .btn:hover {
            background: rgba(249,115,22,0.22);
          }

          .arrow {
            margin-left: auto;
            opacity: 0.6;
          }

          .footer {
            margin-top: 24px;
            font-size: 11px;
            color: var(--muted);
            line-height: 1.6;
          }

          .cli-hint {
            margin-top: 20px;
            padding: 12px;
            border: 1px solid var(--border);
            font-size: 11px;
            color: var(--muted);
          }

          .cli-hint code {
            color: var(--accent);
            background: var(--accent-dim);
            padding: 1px 5px;
          }

          .back {
            display: inline-block;
            margin-top: 20px;
            font-size: 11px;
            color: var(--muted);
            text-decoration: none;
          }

          .back:hover { color: var(--text); }
        `
      }} />

      <div className="page">
        <div className="card">
          <div className="header">
            <div className="label">Authentication</div>
            <div className="brand"><span>0</span>ctx</div>
            <div className="tagline">Persistent context layer for AI tools</div>
          </div>

          {/* Auth0 Universal Login — SDK v4 managed route */}
          <a href="/auth/login" className="btn">
            <span>→</span>
            <span>Sign in</span>
            <span className="arrow">↗</span>
          </a>

          <div className="cli-hint">
            <strong style={{ color: 'var(--text)', fontWeight: 500 }}>CLI users:</strong>
            {' '}run <code>0ctx auth login</code> in your terminal — the browser will open automatically.
          </div>

          <div className="footer">
            By signing in you agree to our terms of service. Auth is handled securely via Auth0.
          </div>

          <Link href="/" className="back">← back to home</Link>
        </div>
      </div>
    </>
  );
}
