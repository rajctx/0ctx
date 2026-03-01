'use client';

interface SparklineProps {
  /** Values 0–1 (normalized heights). */
  values: number[];
  height?: number;
  gap?: boolean[];  // true = render a gap instead of a bar at this index
}

export function Sparkline({ values, height = 32, gap }: SparklineProps) {
  return (
    <div className="l-sparkline" style={{ height }}>
      {values.map((v, i) =>
        gap?.[i] ? (
          <div key={i} className="l-spark-gap" style={{ height: '1px', alignSelf: 'flex-end' }} />
        ) : (
          <div
            key={i}
            className="l-spark-bar"
            style={{ height: `${Math.max(4, Math.round(v * height))}px` }}
          />
        )
      )}
    </div>
  );
}
