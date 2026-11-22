"use client";

import { useEffect, useRef, useState } from "react";
import { fmtPct, fmtSignedUsd } from "@/lib/format";
import { pnlColor, squarify } from "@/lib/portfolio";
import type { Position } from "@/lib/types";

interface HeatmapProps {
  positions: Position[];
  onSelect?: (ticker: string) => void;
}

/** Treemap of positions: area = portfolio weight, color = unrealized P&L %. */
export default function Heatmap({ positions, onSelect }: HeatmapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 400, h: 200 });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byTicker = new Map(positions.map((p) => [p.ticker, p]));
  const rects = squarify(
    positions.map((p) => ({ id: p.ticker, value: Math.abs(p.market_value) })),
    size.w,
    size.h,
  );

  return (
    <div ref={ref} data-testid="heatmap" className="relative h-full w-full overflow-hidden">
      {rects.length === 0 ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted">
          No positions yet. Buy something in the trade bar and it shows up here, sized by weight.
        </div>
      ) : (
        rects.map((r) => {
          const p = byTicker.get(r.id)!;
          const small = r.w < 70 || r.h < 40;
          return (
            <button
              type="button"
              key={r.id}
              data-testid={`heatmap-tile-${r.id}`}
              data-pnl={p.unrealized_pnl >= 0 ? "profit" : "loss"}
              onClick={() => onSelect?.(r.id)}
              title={`${r.id} · ${(p.weight * 100).toFixed(1)}% of holdings · ${fmtSignedUsd(p.unrealized_pnl)}`}
              className="absolute flex flex-col items-start justify-start overflow-hidden border border-canvas p-1.5 text-left transition-[filter] hover:brightness-125"
              style={{
                left: r.x,
                top: r.y,
                width: r.w,
                height: r.h,
                backgroundColor: pnlColor(p.unrealized_pnl_percent),
              }}
            >
              <span className="text-[13px] font-bold leading-none text-ink">{r.id}</span>
              {!small ? (
                <>
                  <span className="num mt-1 text-xs leading-none text-ink/90">{fmtPct(p.unrealized_pnl_percent)}</span>
                  <span className="num mt-0.5 text-[11px] leading-none text-ink/70">{(p.weight * 100).toFixed(1)}%</span>
                </>
              ) : null}
            </button>
          );
        })
      )}
    </div>
  );
}
