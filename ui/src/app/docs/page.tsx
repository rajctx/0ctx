import Link from "next/link";
import { Breadcrumb } from "@/components/docs/breadcrumb";

const cards = [
  {
    title: "Installation",
    desc: "Install the CLI globally and verify your machine is ready.",
    href: "/docs/installation",
  },
  {
    title: "Quickstart",
    desc: "Enable your first repo and start capturing context in under a minute.",
    href: "/docs/quickstart",
  },
  {
    title: "Integrations",
    desc: "How 0ctx captures and retrieves context for Claude Code, Factory, and more.",
    href: "/docs/integrations",
  },
  {
    title: "Data Policy",
    desc: "Local-first defaults, retention windows, and what stays on your machine.",
    href: "/docs/data-policy",
  },
  {
    title: "CLI Reference",
    desc: "Every command, flag, and workflow available in the 0ctx CLI.",
    href: "/docs/cli-reference",
  },
];

export default function DocsOverview() {
  return (
    <>
      <Breadcrumb items={[]} />
      <div className="docs-content">
        <h1>0ctx Documentation</h1>
        <p className="docs-subtitle">
          0ctx is a local-first project memory runtime for AI workflows. It captures
          sessions, checkpoints, and decisions per repo and makes them available to
          any supported agent through the local daemon.
        </p>

        <h2>Start here</h2>
        <div className="docs-cards">
          {cards.slice(0, 2).map((c) => (
            <Link key={c.href} href={c.href} className="docs-card">
              <div className="docs-card-title">{c.title}</div>
              <div className="docs-card-desc">{c.desc}</div>
              <div className="docs-card-arrow">&rarr;</div>
            </Link>
          ))}
        </div>

        <h2>Core concepts</h2>
        <div className="docs-cards">
          {cards.slice(2).map((c) => (
            <Link key={c.href} href={c.href} className="docs-card">
              <div className="docs-card-title">{c.title}</div>
              <div className="docs-card-desc">{c.desc}</div>
              <div className="docs-card-arrow">&rarr;</div>
            </Link>
          ))}
        </div>

        <h2>Why 0ctx exists</h2>
        <ul>
          <li>Most AI workflows lose context between sessions, tools, and branches.</li>
          <li>
            0ctx keeps one durable workspace per repo and groups activity into
            workstreams, sessions, checkpoints, and reviewed insights.
          </li>
          <li>
            The daemon is the source of truth. Supported agents retrieve through the
            local runtime after <code>0ctx enable</code>.
          </li>
        </ul>

        <h2>Repository surfaces</h2>
        <table>
          <thead>
            <tr>
              <th>Surface</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>@0ctx/cli</code></td>
              <td>Primary open-source CLI for enablement, repair, and support workflows</td>
            </tr>
            <tr>
              <td><code>packages/*</code></td>
              <td>Core, daemon, and MCP runtime packages</td>
            </tr>
            <tr>
              <td><code>desktop-app/</code></td>
              <td>Electron management surface for contributors</td>
            </tr>
            <tr>
              <td><code>ui/</code></td>
              <td>Web surface for docs and install guidance</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
