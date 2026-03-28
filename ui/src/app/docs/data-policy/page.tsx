import { Breadcrumb } from "@/components/docs/breadcrumb";
import { PageNav } from "@/components/docs/page-nav";

export const metadata = { title: "Data Policy — 0ctx Docs" };

export default function DataPolicyPage() {
  return (
    <>
      <Breadcrumb items={[{ label: "Data Policy" }]} />
      <div className="docs-content">
        <h1>Data Policy</h1>
        <p className="docs-subtitle">
          0ctx is local-first. The local daemon and SQLite database are the source
          of truth. No data leaves your machine by default.
        </p>

        <h2>Default policy</h2>
        <p>New workspaces default to:</p>
        <table>
          <thead>
            <tr><th>Setting</th><th>Default</th></tr>
          </thead>
          <tbody>
            <tr><td>Workspace data policy</td><td><code>local_only</code></td></tr>
            <tr><td>Local capture retention</td><td><code>14</code> days</td></tr>
            <tr><td>Debug artifacts retention</td><td><code>7</code> days</td></tr>
            <tr><td>Debug artifacts</td><td>Off by default</td></tr>
          </tbody>
        </table>

        <div className="docs-callout">
          <div className="docs-callout-label">Local-only by default</div>
          <p>
            The <code>local_only</code> policy means all captured sessions,
            checkpoints, and workstream state stay on your machine. There is no
            cloud sync or remote storage in the default path.
          </p>
        </div>

        <h2>What stays local</h2>
        <p>
          Local state lives under <code>~/.0ctx/</code> and can include:
        </p>
        <ul>
          <li><strong>SQLite database</strong> &mdash; sessions, checkpoints, workstreams, and workspace metadata</li>
          <li><strong>Hook dumps</strong> &mdash; raw capture output from repo-installed hooks</li>
          <li><strong>Transcript snapshots</strong> &mdash; session transcripts for supported agents</li>
          <li><strong>Backups</strong> &mdash; periodic database backups</li>
        </ul>
        <p>Debug-heavy artifacts are reduced by default to keep the footprint lean.</p>

        <h2>Legacy remote sync states</h2>
        <p>Older builds used two additional workspace settings that are no longer part of the supported path:</p>
        <ul>
          <li>
            <code>metadata_only</code> &mdash; legacy setting from older builds. No longer part of the
            supported local-only path.
          </li>
          <li>
            <code>full_sync</code> &mdash; legacy setting from older builds. Should be normalized back
            to <code>local_only</code>.
          </li>
        </ul>

        <h2>Privacy defaults</h2>
        <ul>
          <li>A clean source build does not send CLI telemetry unless explicitly enabled and configured.</li>
          <li>UI surfaces do not initialize Sentry unless <code>NEXT_PUBLIC_SENTRY_DSN</code> is set.</li>
          <li>Payload and debug data are utility-only &mdash; available for support, debugging, and advanced
            inspection, but not part of the normal workflow.</li>
        </ul>

        <PageNav
          prev={{ label: "Integrations", href: "/docs/integrations" }}
          next={{ label: "CLI Reference", href: "/docs/cli-reference" }}
        />
      </div>
    </>
  );
}
