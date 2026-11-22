"use client";

import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { PricePoint } from "@/hooks/usePriceStream";

interface Props {
  data: PricePoint[];
  color: string;
  testId: string;
  emptyText: string;
  showSeconds?: boolean;
}

function localTime(t: Time, withSeconds: boolean): string {
  const d = new Date((t as number) * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}) });
}

/** Canvas area chart (TradingView Lightweight Charts) that fills its container. */
export default function TimeSeriesChart({ data, color, testId, emptyText, showSeconds = true }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#7b8799",
        fontFamily: "'IBM Plex Sans Condensed', 'Arial Narrow', sans-serif",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(36, 48, 65, 0.55)" },
        horzLines: { color: "rgba(36, 48, 65, 0.55)" },
      },
      rightPriceScale: { borderColor: "#243041" },
      timeScale: {
        borderColor: "#243041",
        timeVisible: true,
        secondsVisible: showSeconds,
        tickMarkFormatter: (t: Time) => localTime(t, false),
      },
      localization: { timeFormatter: (t: Time) => localTime(t, true) },
      crosshair: {
        vertLine: { color: "#4f5b6d", labelBackgroundColor: "#18212d" },
        horzLine: { color: "#4f5b6d", labelBackgroundColor: "#18212d" },
      },
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: color,
      topColor: `${color}55`,
      bottomColor: `${color}05`,
      lineWidth: 2,
      priceLineColor: color,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [color, showSeconds]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    if (data.length > 1) chartRef.current?.timeScale().fitContent();
  }, [data, color, showSeconds]);

  return (
    <div data-testid={testId} data-points={data.length} className="relative h-full w-full">
      <div ref={hostRef} className="absolute inset-0" />
      {data.length < 2 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">
          {emptyText}
        </div>
      ) : null}
    </div>
  );
}
