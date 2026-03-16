import Image from "next/image";
import Link from "next/link";
import "./landing.css";

const heroMeta = [
  "Local daemon",
  "SQLite graph",
  "Repo-first setup",
  "MCP-native",
];

export default function HomePage() {
  return (
    <div id="landing-page">
      <section className="hero-shell">
        <header className="site-header section-inner ui-fade-in">
          <Link href="/" className="brand-mark" aria-label="0ctx home">
            <span className="brand-orb" aria-hidden="true" />
            <span className="brand-lockup">
              <strong>0ctx</strong>
              <span>persistent project memory</span>
            </span>
          </Link>

          <nav className="site-nav" aria-label="Primary">
            <Link href="/docs">Docs</Link>
            <Link href="/install">Install</Link>
            <a
              href="https://github.com/0ctx-com/0ctx"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </nav>

          <Link href="/install" className="site-cta">
            Open install
          </Link>
        </header>

        <div className="hero-copy-wrap section-inner">
          <div className="hero-topline ui-fade-in ui-delay-1">
            <span>[ local-first context engine ]</span>
            <span>zero context loss across tool switches</span>
          </div>

          <div className="hero-body">
            <div className="hero-copy ui-rise-in">
              <h1>Context that stays with the work.</h1>
            </div>

            <div className="hero-side ui-rise-in ui-delay-2">
              <p className="hero-lead">
                0ctx keeps sessions, checkpoints, and decisions attached to the
                repo so the next AI tool can pick up the project without a
                reset.
              </p>

              <div className="hero-actions">
                <Link href="/install" className="button-primary">
                  Open install guide
                </Link>
                <Link href="/docs" className="button-secondary">
                  Read the docs
                </Link>
              </div>

              <p className="hero-note">
                Local recall, repo-bound memory, and a calmer handoff between
                tools.
              </p>
            </div>
          </div>

          <div className="hero-meta ui-fade-in ui-delay-3" aria-label="Core product traits">
            {heroMeta.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>

        <div className="hero-visual ui-rise-in ui-delay-3" aria-hidden="true">
          <Image
            src="/images/landing-background.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className="hero-image"
          />
          <div className="hero-visual-fade" />
        </div>
      </section>
    </div>
  );
}
