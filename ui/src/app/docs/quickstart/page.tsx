import { Breadcrumb } from "@/components/docs/breadcrumb";
import { PageNav } from "@/components/docs/page-nav";

export const metadata = { title: "Quickstart — 0ctx Docs" };

export default function QuickstartPage() {
  return (
    <>
      <Breadcrumb items={[{ label: "Quickstart" }]} />
      <div className="docs-content">
        <h1>Quickstart</h1>
        <p className="docs-subtitle">
          0ctx is repo-first. Enable a repository, use your AI tools normally, and
          let context persist automatically.
        </p>

        <h2>The normal path</h2>
        <pre><code>{`cd <repo>\n0ctx enable\n0ctx status`}</code></pre>
        <p>That's it. Once enabled, 0ctx runs in the background.</p>

        <h2>What <code>0ctx enable</code> does</h2>
        <ol>
          <li>Resolves the repo root</li>
          <li>Creates or binds a workspace for that repo</li>
          <li>Starts or verifies the local daemon</li>
          <li>Installs supported GA capture integrations</li>
          <li>Bootstraps supported GA retrieval integrations</li>
          <li>Reports repo readiness and local retention defaults</li>
        </ol>

        <h2>Daily use</h2>
        <p>For supported GA agents, the intended flow is:</p>
        <ol>
          <li>Run <code>0ctx enable</code> once in the repo</li>
          <li>Use the agent normally in that repo</li>
          <li>Let 0ctx capture sessions and inject retrieval context automatically</li>
        </ol>
        <div className="docs-callout">
          <div className="docs-callout-label">Zero configuration</div>
          <p>
            You don't need to think about <code>contextId</code>, MCP setup, hook
            internals, or transcript plumbing. The normal product path
            is <code>0ctx enable</code> and then work.
          </p>
        </div>

        <h2>Useful commands</h2>
        <pre><code>{`# Repo readiness\n0ctx status\n\n# Manage local capture hooks\n0ctx hook status\n\n# Inspect workstreams\n0ctx workstreams --repo-root .\n\n# Inspect sessions\n0ctx sessions --repo-root .\n\n# Inspect checkpoints\n0ctx checkpoints --repo-root .\n\n# Advanced repair\n0ctx doctor --json\n0ctx repair`}</code></pre>

        <h2>GA and preview integrations</h2>
        <p><strong>GA path</strong> (automatic after enable):</p>
        <ul>
          <li>Claude Code</li>
          <li>Factory / Droid</li>
          <li>Antigravity</li>
        </ul>
        <p><strong>Preview path</strong> (explicit opt-in only):</p>
        <ul>
          <li>Codex</li>
          <li>Cursor</li>
          <li>Windsurf</li>
        </ul>
        <p>
          Preview integrations stay outside the normal setup path. Only use them
          when you explicitly opt in.
        </p>

        <PageNav
          prev={{ label: "Installation", href: "/docs/installation" }}
          next={{ label: "Integrations", href: "/docs/integrations" }}
        />
      </div>
    </>
  );
}
