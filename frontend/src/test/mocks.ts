import { vi } from "vitest";
import type { Portfolio } from "@/lib/types";

/** Minimal controllable EventSource double. */
export class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  close = vi.fn(() => {
    this.readyState = 2;
  });
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  emit(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
  fail(closed = false) {
    this.readyState = closed ? 2 : 0;
    this.onerror?.(new Event("error"));
  }
  static latest() {
    return MockEventSource.instances[MockEventSource.instances.length - 1];
  }
}

export function installEventSource() {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const samplePortfolio: Portfolio = {
  cash_balance: 5000,
  total_value: 6900,
  positions_value: 1900,
  unrealized_pnl: 100,
  positions: [
    {
      ticker: "AAPL",
      quantity: 10,
      avg_cost: 180,
      current_price: 190,
      market_value: 1900,
      unrealized_pnl: 100,
      unrealized_pnl_percent: 5.555,
      weight: 1,
    },
  ],
};

export function tick(ticker: string, price: number, previous: number, timestamp = 1_700_000_000) {
  return {
    [ticker]: {
      ticker,
      price,
      previous_price: previous,
      timestamp,
      change: price - previous,
      change_percent: ((price - previous) / previous) * 100,
      direction: price > previous ? "up" : price < previous ? "down" : "flat",
    },
  };
}
