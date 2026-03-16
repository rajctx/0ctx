import Image from "next/image";
import Link from "next/link";
import "./landing.css";

const heroMeta = [
  "Local daemon",
  "/",
  "SQLite graph",
  "/",
  "Repo-first setup",
  "/",
  "MCP-native",
];

export default function HomePage() {
  return (
    <div id="landing-page">
      <div className="landing-bg">
        <Image
          src="/images/background.png"
          alt="Cosmic background"
          fill
          priority
          sizes="100vw"
          className="landing-bg-image"
        />
        <div className="landing-bg-overlay" />
      </div>

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
          <div className="hero-content ui-rise-in">
            <div className="hero-topline">
              <span>LOCAL-FIRST CONTEXT ENGINE</span>
            </div>
            
            <h1 className="hero-title">
              YOUR TOOLS<br/>
              SHOULD<br/>
              REMEMBER<br/>
              THE PROJECT.
            </h1>

            <p className="hero-lead">
              0ctx keeps sessions, checkpoints, and decisions attached to the
              repo so the next AI tool can continue the work instead of asking
              you to restate it.
            </p>

            <div className="hero-actions">
              <Link href="/install" className="button-primary">
                Open install guide
              </Link>
              <Link href="/docs" className="button-secondary">
                Read the docs
              </Link>
            </div>
          </div>

          <div className="hero-side-content ui-rise-in ui-delay-2">
             <div className="hero-subline">
                <span>ZERO CONTEXT LOSS ACROSS<br/>TOOL SWITCHES.</span>
             </div>
             <p className="hero-note">
               Built for repo-bound workflows<br/>
               where local state should stay<br/>
               recoverable.
             </p>
          </div>
        </div>

        <footer className="site-footer section-inner ui-fade-in ui-delay-3">
          <div className="footer-left">
            <div className="footer-logo">N</div>
            <span>BUILT AROUND THE REPO</span>
          </div>
          <div className="footer-right">
            {heroMeta.map((item, index) => (
              <span key={index} className={item === "/" ? "separator" : ""}>{item}</span>
            ))}
          </div>
        </footer>
      </section>
    </div>
  );
}
