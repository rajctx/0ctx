"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogoMark } from "@/components/brand/logo-mark";

type NavItem = { label: string; href: string };
type NavSection = { title: string; items: NavItem[] };

const NAV: NavSection[] = [
  {
    title: "Getting Started",
    items: [
      { label: "Overview", href: "/docs" },
      { label: "Installation", href: "/docs/installation" },
      { label: "Quickstart", href: "/docs/quickstart" },
    ],
  },
  {
    title: "Integrations",
    items: [
      { label: "Overview", href: "/docs/integrations" },
    ],
  },
  {
    title: "Configuration",
    items: [
      { label: "Data Policy", href: "/docs/data-policy" },
      { label: "CLI Reference", href: "/docs/cli-reference" },
    ],
  },
];

export function DocsSidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile toggle */}
      <button
        className="docs-sidebar-toggle"
        onClick={() => setMobileOpen((v) => !v)}
        aria-label="Toggle navigation"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          {mobileOpen ? (
            <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          ) : (
            <>
              <path d="M3 5H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M3 10H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M3 15H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </>
          )}
        </svg>
      </button>

      {/* Backdrop */}
      {mobileOpen && (
        <div className="docs-sidebar-backdrop" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`docs-sidebar ${mobileOpen ? "docs-sidebar-open" : ""}`}>
        <div className="docs-sidebar-header">
          <Link href="/" className="docs-sidebar-brand">
            <LogoMark size={24} />
            <span>0ctx</span>
          </Link>
          <span className="docs-sidebar-badge">docs</span>
        </div>

        <nav className="docs-sidebar-nav">
          {NAV.map((section) => (
            <div key={section.title} className="docs-nav-section">
              <div className="docs-nav-title">{section.title}</div>
              <ul className="docs-nav-list">
                {section.items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`docs-nav-link ${active ? "docs-nav-active" : ""}`}
                        onClick={() => setMobileOpen(false)}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="docs-sidebar-footer">
          <a
            href="https://github.com/rajctx/0ctx"
            target="_blank"
            rel="noopener noreferrer"
            className="docs-nav-link"
          >
            GitHub
          </a>
          <Link href="/" className="docs-nav-link">
            Home
          </Link>
        </div>
      </aside>
    </>
  );
}
