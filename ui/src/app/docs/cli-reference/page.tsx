import { Breadcrumb } from "@/components/docs/breadcrumb";
import { PageNav } from "@/components/docs/page-nav";

export const metadata = { title: "CLI Reference — 0ctx Docs" };

export default function CLIReferencePage() {
  return (
    <>
      <Breadcrumb items={[{ label: "CLI Reference" }]} />
      <div className="docs-content">
        <h1>CLI Reference</h1>
        <p className="docs-subtitle">
          Every command available in <code>@0ctx/cli</code>. Most users only need
          <code>enable</code> and <code>status</code>.
        </p>

        <h2>Core commands</h2>
        <table>
          <thead>
            <tr><th>Command</th><th>Description</th></tr>
          </thead>
          <tbody>
            <tr><td><code>0ctx enable</code></td><td>Bind a repo, start the daemon, install hooks, and bootstrap retrieval</td></tr>
            <tr><td><code>0ctx status</code></td><td>Show daemon health and repo readiness</td></tr>
            <tr><td><code>0ctx version</code></td><td>Print the CLI version</td></tr>
          </tbody>
        </table>

        <h2>Inspection</h2>
        <table>
          <thead>
            <tr><th>Command</th><th>Description</th></tr>
          </thead>
          <tbody>
            <tr><td><code>0ctx workstreams --repo-root .</code></td><td>List workstreams in the current repo</td></tr>
            <tr><td><code>0ctx sessions --repo-root .</code></td><td>List captured sessions</td></tr>
            <tr><td><code>0ctx checkpoints --repo-root .</code></td><td>List saved checkpoints</td></tr>
          </tbody>
        </table>

        <h2>Hooks</h2>
        <table>
          <thead>
            <tr><th>Command</th><th>Description</th></tr>
          </thead>
          <tbody>
            <tr><td><code>0ctx hook status</code></td><td>Show installed capture hooks for the current repo</td></tr>
          </tbody>
        </table>
        <p>
          <code>hook</code> commands are the supported capture-management surface.
          Older <code>connector hook</code> installs still work as compatibility
          aliases but are not part of the normal flow.
        </p>

        <h2>Repair &amp; diagnostics</h2>
        <table>
          <thead>
            <tr><th>Command</th><th>Description</th></tr>
          </thead>
          <tbody>
            <tr><td><code>0ctx doctor --json</code></td><td>Full machine and repo diagnostics as JSON</td></tr>
            <tr><td><code>0ctx repair</code></td><td>Auto-repair common issues (hooks, daemon, retrieval)</td></tr>
            <tr><td><code>0ctx setup</code></td><td>Advanced machine setup workflow</td></tr>
          </tbody>
        </table>

        <h2>Bootstrap</h2>
        <table>
          <thead>
            <tr><th>Command</th><th>Description</th></tr>
          </thead>
          <tbody>
            <tr><td><code>0ctx bootstrap --clients=ga</code></td><td>Re-bootstrap retrieval for GA agents</td></tr>
            <tr><td><code>0ctx bootstrap --clients=ga --dry-run</code></td><td>Preview what bootstrap would do</td></tr>
            <tr><td><code>0ctx bootstrap --clients=ga --json</code></td><td>Machine-readable bootstrap output</td></tr>
          </tbody>
        </table>

        <h2>Enable options</h2>
        <pre><code>{`# Standard enable\n0ctx enable\n\n# Enable with a specific data policy\n0ctx enable --data-policy=review`}</code></pre>

        <div className="docs-callout">
          <div className="docs-callout-label">Most users</div>
          <p>
            Most users should not need anything beyond <code>0ctx enable</code> and{" "}
            <code>0ctx status</code>. The daemon handles capture, retrieval, and
            workstream management automatically.
          </p>
        </div>

        <PageNav
          prev={{ label: "Data Policy", href: "/docs/data-policy" }}
        />
      </div>
    </>
  );
}
