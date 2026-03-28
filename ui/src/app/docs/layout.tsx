import { DocsSidebar } from "@/components/docs/sidebar";
import "./docs.css";

export const metadata = {
  title: "Documentation — 0ctx",
  description: "Guides, references, and configuration for the 0ctx local-first project memory runtime.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="docs-shell">
      <DocsSidebar />
      <main className="docs-main">{children}</main>
    </div>
  );
}
