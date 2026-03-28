import Link from "next/link";

type NavLink = { label: string; href: string } | null;

export function PageNav({ prev, next }: { prev?: NavLink; next?: NavLink }) {
  if (!prev && !next) return null;
  return (
    <div className="docs-nav-footer">
      {prev ? (
        <Link href={prev.href} className="docs-nav-prev">
          <span className="docs-nav-dir">&larr; Previous</span>
          <span className="docs-nav-label">{prev.label}</span>
        </Link>
      ) : <div />}
      {next ? (
        <Link href={next.href} className="docs-nav-next">
          <span className="docs-nav-dir">Next &rarr;</span>
          <span className="docs-nav-label">{next.label}</span>
        </Link>
      ) : <div />}
    </div>
  );
}
