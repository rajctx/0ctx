import { Breadcrumb } from "@/components/docs/breadcrumb";
import { PageNav } from "@/components/docs/page-nav";

export const metadata = { title: "Integrations — 0ctx Docs" };

export default function IntegrationsPage() {
  return (
    <>
      <Breadcrumb items={[{ label: "Integrations" }]} />
      <div className="docs-content">
        <h1>Integrations</h1>
        <p className="docs-subtitle">
          0ctx separates ingestion (capturing context) from retrieval (providing
          context to agents). Both happen automatically after enable.
        </p>

        <h2>Ingestion</h2>
        <p>Ingestion is deterministic. It comes from:</p>
        <ul>
          <li>Repo-installed hooks</li>
          <li>Session-start integrations</li>
          <li>Transcript and archive readers</li>
        </ul>
        <p>
          Integrations feed the local daemon. The daemon remains the source of truth
          for the local product path.
        </p>

        <h2>Retrieval</h2>
        <p>
          Retrieval for supported agents goes through MCP and daemon-backed context
          packs. The intended user experience is:
        </p>
        <ul>
          <li>Enable once</li>
          <li>Use the agent normally</li>
          <li>Get the right workstream context automatically</li>
        </ul>

        <h2>GA integrations</h2>

        <h3>Claude Code</h3>
        <table>
          <thead>
            <tr><th>Capability</th><th>Mechanism</th></tr>
          </thead>
          <tbody>
            <tr><td>Capture</td><td><code>Stop</code>, <code>SubagentStop</code></td></tr>
            <tr><td>Startup context</td><td><code>SessionStart</code></td></tr>
            <tr><td>Retrieval</td><td>MCP + daemon-backed context pack</td></tr>
          </tbody>
        </table>

        <h3>Factory / Droid</h3>
        <table>
          <thead>
            <tr><th>Capability</th><th>Mechanism</th></tr>
          </thead>
          <tbody>
            <tr><td>Capture</td><td><code>Stop</code>, <code>SubagentStop</code></td></tr>
            <tr><td>Startup context</td><td><code>SessionStart</code></td></tr>
            <tr><td>Retrieval</td><td>Daemon-backed context pack injected on session start</td></tr>
          </tbody>
        </table>

        <h3>Antigravity</h3>
        <table>
          <thead>
            <tr><th>Capability</th><th>Mechanism</th></tr>
          </thead>
          <tbody>
            <tr><td>Capture</td><td>Managed repo hook install</td></tr>
            <tr><td>Startup context</td><td>Session-start integration path</td></tr>
            <tr><td>Retrieval</td><td>Daemon-backed context pack</td></tr>
          </tbody>
        </table>

        <h2>Preview integrations</h2>
        <p>
          Preview integrations are supported only when explicitly opted into.
          They are intentionally outside the normal product path.
        </p>
        <ul>
          <li><strong>Codex</strong></li>
          <li><strong>Cursor</strong></li>
          <li><strong>Windsurf</strong></li>
        </ul>

        <div className="docs-callout">
          <div className="docs-callout-label">Product rule</div>
          <p>
            Users should not need to think
            about <code>contextId</code>, MCP setup details, hook event internals,
            or transcript plumbing. The normal path
            is <code>cd &lt;repo&gt; && 0ctx enable</code>.
          </p>
        </div>

        <PageNav
          prev={{ label: "Quickstart", href: "/docs/quickstart" }}
          next={{ label: "Data Policy", href: "/docs/data-policy" }}
        />
      </div>
    </>
  );
}
