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
            <svg className="brand-orb" aria-hidden="true" viewBox="0 0 256 256" fill="none">
              <defs>
                <linearGradient id="brandMarkGradient" x1="50" y1="58" x2="192" y2="196" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#FFD8A8" />
                  <stop offset="0.55" stopColor="#F39158" />
                  <stop offset="1" stopColor="#D56333" />
                </linearGradient>
              </defs>
              <path
                d="M153.84 84.16A62 62 0 1 0 153.84 171.84"
                stroke="url(#brandMarkGradient)"
                strokeWidth="28"
                strokeLinecap="round"
              />
              <path
                d="M58 154L171 103"
                stroke="url(#brandMarkGradient)"
                strokeWidth="24"
                strokeLinecap="round"
              />
              <circle cx="184" cy="98" r="18" fill="#FFF3E7" />
            </svg>
            <span className="brand-lockup">
              <strong>0ctx</strong>
              <span>persistent project memory</span>
            </span>
          </Link>

            <nav className="site-nav" aria-label="Primary">
              <Link href="/docs">Docs</Link>
              <Link href="/install">Install</Link>
              <a
                href="https://github.com/rajctx/0ctx"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </nav>

            <Link href="/install" className="site-cta">
            Open install guide
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
