"use client";

import { useEffect, useState } from "react";
import { fmtPrice, fmtQty } from "@/lib/format";
import type { Trade } from "@/lib/types";

interface Props {
  ticker: string | null;
  price: number | null;
  onTrade: (ticker: string, quantity: number, side: "buy" | "sell") => Promise<Trade>;
}

const TICKER_RE = /^[A-Z.]{1,10}$/;

export default function TradeBar({ ticker: selected, price, onTrade }: Props) {
  const [ticker, setTicker] = useState(selected ?? "");
  const [qty, setQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"buy" | "sell" | null>(null);

  // Follow the selected ticker from the watchlist / chart.
  useEffect(() => {
    if (selected) setTicker(selected);
  }, [selected]);

  const submit = async (side: "buy" | "sell") => {
    const t = ticker.trim().toUpperCase();
    const q = Number(qty);
    setNotice(null);
    if (!TICKER_RE.test(t)) {
      setError("Enter a symbol, e.g. AAPL");
      return;
    }
    if (!qty.trim() || !Number.isFinite(q) || q <= 0) {
      setError("Enter a quantity greater than 0");
      return;
    }
    setError(null);
    setBusy(side);
    try {
      const trade = await onTrade(t, q, side);
      setNotice(`${trade.side === "buy" ? "Bought" : "Sold"} ${fmtQty(trade.quantity)} ${trade.ticker} @ ${fmtPrice(trade.price)}`);
      setQty("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trade failed");
    } finally {
      setBusy(null);
    }
  };

  const est = price !== null && Number(qty) > 0 ? price * Number(qty) : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit("buy");
      }}
      className="flex flex-wrap items-center gap-2 border-t border-line bg-panel px-2.5 py-2"
      aria-label="Trade"
    >
      <span className="text-[13px] font-semibold">Market order</span>
      <input
        data-testid="trade-ticker-input"
        aria-label="Symbol"
        placeholder="Symbol"
        value={ticker}
        maxLength={10}
        onChange={(e) => {
          setTicker(e.target.value.toUpperCase());
          setError(null);
        }}
        className="w-24 border border-line bg-canvas px-2 py-1 text-sm font-semibold uppercase placeholder:font-normal placeholder:normal-case placeholder:text-faint focus:border-blue focus:outline-none"
      />
      <input
        data-testid="trade-quantity-input"
        aria-label="Quantity"
        placeholder="Qty"
        inputMode="decimal"
        type="number"
        min="0"
        step="any"
        value={qty}
        onChange={(e) => {
          setQty(e.target.value);
          setError(null);
        }}
        className="num w-24 border border-line bg-canvas px-2 py-1 text-sm placeholder:text-faint focus:border-blue focus:outline-none"
      />
      <button
        type="button"
        data-testid="trade-buy-button"
        disabled={busy !== null}
        onClick={() => submit("buy")}
        className="bg-purple px-4 py-1 text-sm font-semibold text-white hover:bg-purple-hover disabled:opacity-50"
      >
        {busy === "buy" ? "Buying…" : "Buy"}
      </button>
      <button
        type="button"
        data-testid="trade-sell-button"
        disabled={busy !== null}
        onClick={() => submit("sell")}
        className="border border-purple px-4 py-1 text-sm font-semibold text-ink hover:bg-purple/25 disabled:opacity-50"
      >
        {busy === "sell" ? "Selling…" : "Sell"}
      </button>
      <span className="num text-xs text-muted">{est !== null ? `≈ $${est.toFixed(2)}` : ""}</span>
      {error ? (
        <span data-testid="trade-error" role="alert" className="text-xs text-down">
          {error}
        </span>
      ) : notice ? (
        <span role="status" className="text-xs text-up">
          {notice}
        </span>
      ) : null}
    </form>
  );
}
