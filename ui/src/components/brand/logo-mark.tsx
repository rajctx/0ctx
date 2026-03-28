/**
 * 0ctx Logo Mark — "The Context Zero"
 *
 * A clean geometric zero (circle) with a deliberate gap and a floating
 * dot that represents captured context. Minimal, modern, works at any size.
 *
 * Uses currentColor so it inherits text color from the parent.
 */
export function LogoMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      {/* Zero arc — 310° of a circle, gap at top-right */}
      <path
        d="M21 5.1A12 12 0 1 0 26.9 11"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      {/* Context dot — floating in the gap */}
      <circle cx="24.5" cy="7.2" r="2.2" fill="currentColor" />
    </svg>
  );
}
