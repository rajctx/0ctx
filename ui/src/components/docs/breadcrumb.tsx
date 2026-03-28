import Link from "next/link";

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <div className="docs-topbar">
      <div className="docs-breadcrumb">
        <Link href="/docs">Docs</Link>
        {items.map((item, i) => (
          <span key={i}>
            <span className="docs-breadcrumb-sep">/</span>{" "}
            {item.href ? (
              <Link href={item.href}>{item.label}</Link>
            ) : (
              <span className="docs-breadcrumb-current">{item.label}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
