import Image from "next/image";
import Link from "next/link";
import { Fragment } from "react";
import { CopyCommand } from "@/components/landing/copy-command";
import { ScrollReveal } from "@/components/landing/scroll-reveal";
import { WorkflowSteps } from "@/components/landing/workflow-steps";
import { LogoMark } from "@/components/brand/logo-mark";
import "./landing.css";

export const metadata = {
  title: "0ctx — Local-first project memory for AI workflows",
  description:
    "Sessions, checkpoints, and decisions attached to the repo. Zero context loss across tool switches.",
};

const pillars = ["Local daemon", "SQLite graph", "Repo-bound", "MCP-native"];

const problems = [
  {
    title: "Sessions vanish",
    desc: "Close the tab, lose the thread. No tool remembers what the last one discussed.",
  },
  {
    title: "Decisions evaporate",
    desc: "You made a call and moved on. The reasoning lives in a chat log you\u2019ll never reopen.",
  },
  {
    title: "Context silos",
    desc: "Each AI tool builds its own understanding. Nothing transfers between them.",
  },
];

const features = [
  {
    name: "SESSIONS",
    desc: "Conversations captured automatically, tied to branches and commits. Every turn preserved.",
  },
  {
    name: "CHECKPOINTS",
    desc: "Decision snapshots at meaningful moments. The \u2018why\u2019 behind the \u2018what\u2019 \u2014 always recoverable.",
  },
  {
    name: "WORKSTREAMS",
    desc: "Parallel work contexts within a repo. Feature branch memory stays cleanly isolated.",
  },
  {
    name: "INSIGHTS",
    desc: "Reviewed learnings that persist across sessions. Cross-session knowledge that compounds.",
  },
];

const archPoints = [
  {
    label: "Local SQLite graph",
    desc: "No cloud, no latency. Your data stays on your machine.",
  },
  {
    label: "MCP protocol",
    desc: "Tool-agnostic capture and recall. Not locked to any vendor.",
  },
  {
    label: "Repo-bound",
    desc: "Context lives with the code. Clone the repo, get the memory.",
  },
  {
    label: "Zero config",
    desc: "Works with Claude Code, Cursor, and any MCP client.",
  },
];

export default function HomePage() {
  return (
    <div id="landing-page">
      <ScrollReveal />
      {/* ─── Background ─── */}
      <div className="landing-bg">
        <Image
          src="/images/background.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="landing-bg-image"
        />
        <div className="landing-bg-overlay" />
      </div>

      {/* ═══════════════════ HERO ═══════════════════ */}
      <section className="hero-shell">
        <header className="site-header section-inner ui-fade-in">
          <Link href="/" className="brand-mark" aria-label="0ctx home">
            <LogoMark size={36} className="brand-orb" />
            <span className="brand-lockup">
              <strong>0ctx</strong>
              <span>persistent project memory</span>
            </span>
          </Link>

          <nav className="site-nav" aria-label="Primary">
            <Link href="/docs">Docs</Link>
            <Link href="/install">Install</Link>
            <a
              href="https://github.com/nicholasgriffintn/0ctx"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </nav>

          <Link href="/install" className="site-cta">
            Get started
          </Link>
        </header>

        <div className="hero-body section-inner">
          <div className="hero-primary ui-rise-in">
            <div className="hero-topline">LOCAL-FIRST PROJECT MEMORY</div>
            <h1 className="hero-title">
              The project
              <br />
              remembers.
            </h1>
            <p className="hero-lead">
              0ctx captures sessions, checkpoints, and decisions at the repo
              level. Switch tools &mdash; the context follows.
            </p>
            <div className="hero-install ui-rise-in ui-delay-1">
              <CopyCommand command="npm i -g @0ctx/cli" />
            </div>
            <div className="hero-actions ui-rise-in ui-delay-2">
              <Link href="/docs" className="button-ghost">
                Read the docs &rarr;
              </Link>
            </div>
          </div>

          <div className="hero-terminal ui-rise-in ui-delay-2">
            <div className="term-bar">
              <div className="term-dots"><span /><span /><span /></div>
              <span className="term-title">Terminal</span>
            </div>
            <div className="term-body">
              <div className="term-line">
                <span className="term-prompt">~/dev/inbox-agent $</span>{" "}
                <span className="term-cmd">0ctx enable</span>
              </div>
              <div className="term-badge-line">
                <span className="term-badge">0ctx enable</span>
              </div>
              <div className="term-status">
                <span className="term-diamond">&#x25C7;</span>
                <span>0ctx is enabled for this repository</span>
              </div>
              <div className="term-gap" />
              <div className="term-status">
                <span className="term-diamond">&#x25C7;</span>
                <span>Repo Readiness ────────────────────</span>
              </div>
              <div className="term-readout">
                <div className="term-row">
                  <span className="term-key">Repo</span>
                  <span className="term-val">: ~/dev/inbox-agent</span>
                </div>
                <div className="term-row">
                  <span className="term-key">Workspace</span>
                  <span className="term-val">: inbox-agent</span>
                </div>
                <div className="term-row">
                  <span className="term-key">Workstream</span>
                  <span className="term-val">: develop</span>
                </div>
                <div className="term-row">
                  <span className="term-key">Ready</span>
                  <span className="term-val">: zero-touch for supported agents</span>
                </div>
                <div className="term-row">
                  <span className="term-key">Policy</span>
                  <span className="term-val">: Lean is the normal default.</span>
                </div>
                <div className="term-row">
                  <span className="term-key">Capture</span>
                  <span className="term-val">: Claude, Factory, Antigravity ready</span>
                </div>
                <div className="term-row">
                  <span className="term-key">Context</span>
                  <span className="term-val">: inject current workstream context</span>
                </div>
                <div className="term-row">
                  <span className="term-key">History</span>
                  <span className="term-val">: 2 sessions, 1 checkpoints</span>
                </div>
              </div>
              <div className="term-gap" />
              <div className="term-final">
                <span className="term-diamond-fill">&#x25C6;</span>
                <span>Use a supported agent normally in this repo. 0ctx will inject current context and route capture automatically.</span>
              </div>
            </div>
          </div>
        </div>

        <div className="hero-pillars section-inner ui-fade-in ui-delay-3">
          <div className="pillar-row">
            {pillars.map((p, i) => (
              <Fragment key={i}>
                {i > 0 && <span className="pillar-sep">/</span>}
                <span className="pillar">{p}</span>
              </Fragment>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════ BELOW FOLD ═══════════════════ */}
      <div className="below-fold">
        {/* ─── Product Showcase ─── */}
        <section className="showcase-section">
          <div className="section-inner-wide">
            <div className="showcase-frame">
              <div className="showcase-bar">
                <div className="showcase-dots">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="showcase-bar-title">
                  0ctx &mdash; project memory
                </span>
              </div>
              <div className="showcase-body">
                {/* Sidebar */}
                <div className="sc-sidebar">
                  <div className="sc-sys-header">
                    0CTX_SYS / MEMORY{" "}
                    <span className="sc-cursor">&#x258C;</span>
                  </div>
                  <div className="sc-gap" />
                  <div className="sc-line dim">[-] WORKSPACES</div>
                  <div className="sc-line indent">
                    <span className="sc-bracket">[ ]</span> 0ctx-dev
                  </div>
                  <div className="sc-line indent active">
                    <span className="sc-bracket">[&bull;]</span> inbox-agent
                  </div>
                  <div className="sc-gap" />
                  <div className="sc-line dim">[+] WORKSTREAMS</div>
                  <div className="sc-line dim">[-] SESSIONS</div>
                  <div className="sc-line indent-2 active">
                    <span className="sc-bracket">[&bull;]</span> Session 1
                  </div>
                  <div className="sc-line indent-2 sc-session-sub">
                    develop &middot; factory &middot; 4 turns
                  </div>
                  <div className="sc-line indent-2 sc-session-sub dim">
                    and which nextjs version
                  </div>
                  <div className="sc-line indent-2">
                    <span className="sc-bracket">[ ]</span> Session 2
                  </div>
                  <div className="sc-gap" />
                  <div className="sc-line dim">[+] CHECKPOINTS</div>
                  <div className="sc-line dim">[+] INSIGHTS</div>
                  <div className="sc-gap" />
                  <div className="sc-line dim">[+] SETUP</div>
                </div>

                {/* Main Content */}
                <div className="sc-main">
                  <div className="sc-breadcrumb">
                    WORKSTREAMS / INBOX-AGENT / SESSIONS
                    <span className="sc-filter">[ ] FILTER</span>
                    <span className="sc-action">[+] CREATE CHECKPOINT</span>
                  </div>
                  <div className="sc-gap-lg" />
                  <div className="sc-session-title">
                    &gt;&gt; SESSION 1: AND WHICH NEXTJS VERSION
                  </div>
                  <div className="sc-session-meta">
                    develop &middot; factory &middot; 4 turns &middot; Mar 13,
                    9:36 PM
                  </div>
                  <div className="sc-gap-lg" />
                  <div className="sc-turn">
                    <span className="sc-time">21:34:34</span>
                    <span className="sc-role">USER</span>
                    <span className="sc-text">how to setup this project</span>
                  </div>
                  <div className="sc-gap-sm" />
                  <div className="sc-turn">
                    <span className="sc-time">21:35:09</span>
                    <span className="sc-role">ASSISTANT</span>
                    <div className="sc-text-block">
                      This is a <strong>Next.js + Express + Mastra</strong>{" "}
                      email client project. Here&rsquo;s how to set it up:
                      <br />
                      <br />
                      1. Install dependencies: <code>bash npm install</code>
                      <br />
                      2. Configure environment: Copy{" "}
                      <code>.env.example</code> to <code>.env.local</code>
                    </div>
                  </div>
                  <div className="sc-gap-sm" />
                  <div className="sc-turn">
                    <span className="sc-time">21:35:54</span>
                    <span className="sc-role">USER</span>
                    <span className="sc-text">and which nextjs version</span>
                  </div>
                  <div className="sc-gap-sm" />
                  <div className="sc-turn">
                    <span className="sc-time">21:36:25</span>
                    <span className="sc-role">ASSISTANT</span>
                    <span className="sc-text">
                      The project uses{" "}
                      <strong>Next.js 16.0.4</strong> (with Turbopack)
                      and React 19.0.0.
                    </span>
                  </div>
                </div>

                {/* Detail Panel */}
                <div className="sc-detail">
                  <div className="sc-panel-section">
                    <div className="sc-panel-header">[-] SUMMARY</div>
                    <div className="sc-panel-title">
                      AND WHICH NEXTJS VERSION
                    </div>
                    <div className="sc-panel-body">
                      and which nextjs version &rarr; The project uses Next.js
                      16.0.4 (with Turbopack) and React 19.0.0.
                    </div>
                  </div>

                  <div className="sc-panel-section">
                    <div className="sc-panel-header">
                      [-] FACTS &amp; DIRECTIVES
                    </div>
                    <div className="sc-panel-row">
                      <span className="sc-idx">A</span>
                      <span>[+] Branch: develop</span>
                    </div>
                    <div className="sc-panel-row">
                      <span className="sc-idx">B</span>
                      <span>[+] Agent: factory</span>
                    </div>
                    <div className="sc-panel-row">
                      <span className="sc-idx">C</span>
                      <span>[+] 4 captured messages</span>
                    </div>
                    <div className="sc-panel-row">
                      <span className="sc-idx">D</span>
                      <span>[+] 1 checkpoints linked</span>
                    </div>
                    <div className="sc-panel-row">
                      <span className="sc-idx">E</span>
                      <span>[+] ~/dev/inbox-agent</span>
                    </div>
                  </div>

                  <div className="sc-panel-section">
                    <div className="sc-panel-header dim">[-] INSIGHTS</div>
                    <div className="sc-panel-row">
                      <span className="sc-idx">1</span>
                      <span className="dim">
                        [-] Repo-first daily work should stay in the agent;
                        desktop is for inspecting...
                      </span>
                    </div>
                  </div>

                  <div className="sc-panel-section sc-tech-section">
                    <div className="sc-panel-header dim">
                      [-] TECHNICAL DETAILS
                    </div>
                    <div className="sc-detail-row">
                      <span className="sc-detail-key">STATE:</span>{" "}
                      <strong>Synchronized</strong>
                    </div>
                    <div className="sc-detail-row">
                      <span className="sc-detail-key">MESSAGES:</span>{" "}
                      <strong>4</strong>
                    </div>
                    <div className="sc-detail-row">
                      <span className="sc-detail-key">AGENT:</span>{" "}
                      <strong>factory</strong>
                    </div>
                    <div className="sc-detail-row">
                      <span className="sc-detail-key">COMMIT:</span>{" "}
                      <strong>#2047fe4d</strong>
                    </div>
                    <div className="sc-detail-row">
                      <span className="sc-detail-key">VERSION:</span>{" "}
                      <strong>0.1.20</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Problem ─── */}
        <section className="problem-section reveal">
          <div className="section-inner">
            <div className="section-label">THE PROBLEM</div>
            <h2 className="section-heading">
              Every AI session starts from zero.
            </h2>
            <p className="section-sub">
              You switch tools. You close a tab. You come back tomorrow. The
              context is gone.
            </p>
            <div className="problem-grid">
              {problems.map((p) => (
                <div key={p.title} className="problem-card">
                  <h3 className="problem-title">{p.title}</h3>
                  <p className="problem-desc">{p.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Features ─── */}
        <section className="features-section reveal">
          <div className="section-inner">
            <div className="section-label">WHAT IT CAPTURES</div>
            <div className="features-grid">
              {features.map((f) => (
                <div key={f.name} className="feature-card">
                  <div className="feature-bracket">[+]</div>
                  <h3 className="feature-name">{f.name}</h3>
                  <p className="feature-desc">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── How it works ─── */}
        <section className="workflow-section reveal">
          <div className="section-inner">
            <div className="section-label">HOW IT WORKS</div>
            <p className="workflow-lead">
              Four steps from install to persistent project memory.
              Zero configuration, zero cloud dependencies.
            </p>
            <WorkflowSteps />
          </div>
        </section>

        {/* ─── Architecture ─── */}
        <section className="arch-section reveal">
          <div className="section-inner">
            <div className="section-label">ARCHITECTURE</div>
            <div className="arch-grid">
              {archPoints.map((a) => (
                <div key={a.label} className="arch-card">
                  <h3 className="arch-label">{a.label}</h3>
                  <p className="arch-desc">{a.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Works With ─── */}
        <section className="compat-section reveal">
          <div className="section-inner">
            <div className="section-label">WORKS WITH ANY MCP CLIENT</div>
            <p className="compat-lead">
              0ctx uses the Model Context Protocol. Any tool that speaks MCP gets
              full project memory automatically.
            </p>
            <div className="compat-grid">
              <div className="compat-item">
                <div className="compat-icon">
                  {/* Claude / Anthropic */}
                  <svg viewBox="0 0 24 24" fill="none" width="24" height="24">
                    <path d="M16.273 3.5L9.49 20.5h-2.36L14.07 3.5z" fill="currentColor" />
                    <path d="M10.244 3.5L3.461 20.5H1.1L7.883 3.5z" fill="currentColor" />
                    <path d="M18.634 3.5L11.85 20.5h-2.36l6.784-17z" fill="currentColor" />
                    <path d="M22.9 3.5L16.117 20.5h-2.36L20.54 3.5z" fill="currentColor" />
                  </svg>
                </div>
                <span className="compat-name">Claude Code</span>
              </div>
              <div className="compat-item">
                <div className="compat-icon">
                  {/* Cursor */}
                  <svg viewBox="0 0 24 24" fill="none" width="24" height="24">
                    <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
                    <path d="M8 8l4 8 1.5-3.5L17 11z" fill="currentColor" />
                  </svg>
                </div>
                <span className="compat-name">Cursor</span>
              </div>
              <div className="compat-item">
                <div className="compat-icon">
                  {/* VS Code */}
                  <svg viewBox="0 0 24 24" fill="none" width="24" height="24">
                    <path d="M17 2.5L9 10l-4-3.5L3 7.5l5 4.5-5 4.5 2 1 4-3.5 8 7.5 4-1.5V4z" fill="currentColor" opacity="0.85" />
                    <path d="M17 2.5v19l4-1.5V4z" fill="currentColor" />
                  </svg>
                </div>
                <span className="compat-name">VS Code</span>
              </div>
              <div className="compat-item">
                <div className="compat-icon">
                  {/* GitHub Copilot */}
                  <svg viewBox="0 0 24 24" fill="none" width="24" height="24">
                    <path d="M12 2C6.5 2 2 6.5 2 12c0 4.4 2.9 8.2 6.8 9.5.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.4-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.8.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.5-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 015 0c1.9-1.3 2.7-1 2.7-1 .6 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0022 12c0-5.5-4.5-10-10-10z" fill="currentColor" />
                  </svg>
                </div>
                <span className="compat-name">GitHub Copilot</span>
              </div>
              <div className="compat-item">
                <div className="compat-icon">
                  {/* MCP / protocol */}
                  <svg viewBox="0 0 24 24" fill="none" width="24" height="24">
                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
                    <circle cx="5" cy="6" r="2" stroke="currentColor" strokeWidth="1.5" />
                    <circle cx="19" cy="6" r="2" stroke="currentColor" strokeWidth="1.5" />
                    <circle cx="5" cy="18" r="2" stroke="currentColor" strokeWidth="1.5" />
                    <circle cx="19" cy="18" r="2" stroke="currentColor" strokeWidth="1.5" />
                    <line x1="6.5" y1="7.5" x2="10" y2="10.5" stroke="currentColor" strokeWidth="1.5" />
                    <line x1="17.5" y1="7.5" x2="14" y2="10.5" stroke="currentColor" strokeWidth="1.5" />
                    <line x1="6.5" y1="16.5" x2="10" y2="13.5" stroke="currentColor" strokeWidth="1.5" />
                    <line x1="17.5" y1="16.5" x2="14" y2="13.5" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </div>
                <span className="compat-name">Any MCP client</span>
              </div>
            </div>
          </div>
        </section>

        {/* ─── CTA ─── */}
        <section className="cta-section">
          <div className="section-inner cta-inner">
            <h2 className="cta-title">Start remembering.</h2>
            <div className="cta-install">
              <CopyCommand command="npm i -g @0ctx/cli" />
            </div>
            <div className="cta-links">
              <Link href="/docs">Documentation</Link>
              <span className="cta-sep">&middot;</span>
              <a
                href="https://github.com/nicholasgriffintn/0ctx"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
              <span className="cta-sep">&middot;</span>
              <Link href="/install">Install guide</Link>
            </div>
          </div>
        </section>

        {/* ─── Footer ─── */}
        <footer className="landing-footer">
          <div className="section-inner footer-grid">
            <div className="footer-brand-col">
              <div className="footer-brand-logo">
                <LogoMark size={28} className="brand-orb" />
                <strong>0ctx</strong>
              </div>
              <p className="footer-tagline">
                Local-first project memory<br />for AI workflows.
              </p>
              <div className="footer-license">Apache-2.0 &middot; v0.1.20</div>
            </div>
            <div className="footer-col">
              <h4 className="footer-col-title">Product</h4>
              <Link href="/docs">Documentation</Link>
              <Link href="/install">Install guide</Link>
              <a href="https://github.com/nicholasgriffintn/0ctx/releases" target="_blank" rel="noopener noreferrer">Changelog</a>
            </div>
            <div className="footer-col">
              <h4 className="footer-col-title">Developers</h4>
              <a href="https://github.com/nicholasgriffintn/0ctx" target="_blank" rel="noopener noreferrer">GitHub</a>
              <a href="https://github.com/nicholasgriffintn/0ctx/issues" target="_blank" rel="noopener noreferrer">Issues</a>
              <a href="https://github.com/nicholasgriffintn/0ctx/discussions" target="_blank" rel="noopener noreferrer">Discussions</a>
            </div>
            <div className="footer-col">
              <h4 className="footer-col-title">Resources</h4>
              <Link href="/docs">Getting started</Link>
              <Link href="/docs">MCP integration</Link>
              <Link href="/docs">CLI reference</Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
