"use client";

import { useEffect, useRef, useState } from "react";
import { toUnixSeconds } from "@/lib/format";
import type { ConnectionStatus, PriceMap, PriceUpdate } from "@/lib/types";

export interface PricePoint {
  time: number; // unix seconds
  value: number;
}

export type PriceHistory = Record<string, PricePoint[]>;

export const MAX_HISTORY_POINTS = 600;
const RECONNECT_MS = 3000;

/** Append a point to a ticker series, keeping one point per second (last one wins). */
export function appendPoint(series: PricePoint[] | undefined, point: PricePoint, max = MAX_HISTORY_POINTS): PricePoint[] {
  const prev = series ?? [];
  const last = prev[prev.length - 1];
  const t = Math.floor(point.time);
  let next: PricePoint[];
  if (last && t <= last.time) {
    next = [...prev.slice(0, -1), { time: last.time, value: point.value }];
  } else {
    next = [...prev, { time: t, value: point.value }];
  }
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * Subscribes to /api/stream/prices via EventSource. Exposes the latest price per ticker,
 * a per-ticker history accumulated since page load (sparklines + main chart), the first
 * price seen this session (baseline for the session change %), and connection status.
 */
export function usePriceStream(url = "/api/stream/prices") {
  const [prices, setPrices] = useState<PriceMap>({});
  const [history, setHistory] = useState<PriceHistory>({});
  const [baseline, setBaseline] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<ConnectionStatus>("reconnecting");
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      setStatus("disconnected");
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed) return;
      const es = new EventSource(url);
      esRef.current = es;
      setStatus(es.readyState === 1 ? "connected" : "reconnecting");

      es.onopen = () => setStatus("connected");
      es.onerror = () => {
        if (es.readyState === 2) {
          // Browser gave up retrying: show disconnected and retry ourselves.
          setStatus("disconnected");
          es.close();
          timer = setTimeout(connect, RECONNECT_MS);
        } else {
          setStatus("reconnecting");
        }
      };
      es.onmessage = (ev: MessageEvent) => {
        let payload: Record<string, PriceUpdate>;
        try {
          payload = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (!payload || typeof payload !== "object") return;
        const updates = Object.values(payload).filter(
          (u): u is PriceUpdate => !!u && typeof u.price === "number" && typeof u.ticker === "string",
        );
        if (!updates.length) return;
        setStatus("connected");
        setPrices((prev) => {
          const next = { ...prev };
          for (const u of updates) next[u.ticker] = u;
          return next;
        });
        setBaseline((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const u of updates) {
            if (next[u.ticker] === undefined) {
              next[u.ticker] = u.previous_price ?? u.price;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
        setHistory((prev) => {
          const next = { ...prev };
          for (const u of updates) {
            next[u.ticker] = appendPoint(next[u.ticker], { time: toUnixSeconds(u.timestamp), value: u.price });
          }
          return next;
        });
      };
    };

    connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      esRef.current?.close();
    };
  }, [url]);

  return { prices, history, baseline, status };
}
