import { Breadcrumb } from "@/components/docs/breadcrumb";
import { PageNav } from "@/components/docs/page-nav";

export const metadata = { title: "Installation — 0ctx Docs" };

export default function InstallationPage() {
  return (
    <>
      <Breadcrumb items={[{ label: "Installation" }]} />
      <div className="docs-content">
        <h1>Installation</h1>
        <p className="docs-subtitle">
          Install the CLI globally, verify the daemon is running, and enable your
          first repository. Takes about 30 seconds.
        </p>

        <div className="docs-step">
          <div className="docs-step-num">1</div>
          <div className="docs-step-body">
            <h3>Install the CLI</h3>
            <p>Install <code>@0ctx/cli</code> globally from npm:</p>
            <pre><code>npm install -g @0ctx/cli</code></pre>
            <p>
              This gives you the <code>0ctx</code> command. It works on macOS,
              Linux, and WSL. Node 18+ is required.
            </p>
          </div>
        </div>

        <div className="docs-step">
          <div className="docs-step-num">2</div>
          <div className="docs-step-body">
            <h3>Check the runtime</h3>
            <p>Verify the daemon is reachable:</p>
            <pre><code>0ctx status</code></pre>
            <p>
              This starts the local daemon if it isn't running and reports machine
              readiness. If something is wrong, run <code>0ctx doctor --json</code> for
              diagnostics.
            </p>
          </div>
        </div>

        <div className="docs-step">
          <div className="docs-step-num">3</div>
          <div className="docs-step-body">
            <h3>Enable a repository</h3>
            <p>Navigate into any git repo and enable it:</p>
            <pre><code>{`cd ~/dev/my-project\n0ctx enable`}</code></pre>
            <p>This resolves the repo root, creates a workspace, installs capture
              hooks for GA integrations, bootstraps retrieval, and reports readiness.</p>
          </div>
        </div>

        <div className="docs-callout">
          <div className="docs-callout-label">What happens after enable</div>
          <p>
            The daemon binds to the repo, installs supported capture integrations,
            and configures automatic retrieval. From this point, any supported agent
            (Claude Code, Factory, Antigravity) gets project memory injected
            automatically when it starts a session in this repo.
          </p>
        </div>

        <h2>Monorepo development</h2>
        <p>
          If you're contributing to 0ctx itself and want to run from source:
        </p>
        <pre><code>{`npm install\nnpm run build\nnpm run cli:install-local\ncd <repo>\n0ctx enable`}</code></pre>

        <h2>Troubleshooting</h2>
        <p>
          If <code>0ctx status</code> reports issues, the repair commands can fix
          most problems automatically:
        </p>
        <pre><code>{`# Full diagnostics\n0ctx doctor --json\n\n# Auto-repair\n0ctx repair\n\n# Re-bootstrap retrieval for GA agents\n0ctx bootstrap --clients=ga`}</code></pre>

        <PageNav
          prev={{ label: "Overview", href: "/docs" }}
          next={{ label: "Quickstart", href: "/docs/quickstart" }}
        />
      </div>
    </>
  );
}
