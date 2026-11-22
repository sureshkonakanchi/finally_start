import type { PricePoint } from "@/hooks/usePriceStream";

interface SparklineProps {
  points: PricePoint[] | undefined;
  width?: number;
  height?: number;
  maxPoints?: number;
}

/** Tiny SVG line of price since page load. Color follows the session direction. */
export default function Sparkline({ points, width = 84, height = 22, maxPoints = 120 }: SparklineProps) {
  const data = (points ?? []).slice(-maxPoints);
  if (data.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden data-testid="sparkline">
        <line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke="var(--color-line-strong)" strokeDasharray="2 3" />
      </svg>
    );
  }
  const values = data.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (data.length - 1);
  const d = data
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - 2 - ((p.value - min) / span) * (height - 4)).toFixed(1)}`)
    .join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} aria-hidden data-testid="sparkline">
      <path d={d} fill="none" stroke={up ? "var(--color-up)" : "var(--color-down)"} strokeWidth={1.25} strokeLinejoin="round" />
    </svg>
  );
}
