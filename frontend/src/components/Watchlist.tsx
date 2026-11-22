"use client";

import { useState, type FormEvent } from "react";
import Panel from "./Panel";
import Sparkline from "./Sparkline";
import { usePriceFlash } from "@/hooks/usePriceFlash";
import type { PriceHistory } from "@/hooks/usePriceStream";
import { fmtPct, fmtPrice, toneClass } from "@/lib/format";
import type { PriceMap, WatchlistItem } from "@/lib/types";

export const TICKER_RE = /^[A-Z.]{1,10}$/;

interface RowProps {
  ticker: string;
  price: number | null;
  changePct: number | null;
  history: PriceHistory[string] | undefined;
  selected: boolean;
  onSelect: (t: string) => void;
  onRemove: (t: string) => void;
}

export function WatchlistRow({ ticker, price, changePct, history, selected, onSelect, onRemove }: RowProps) {
  const flash = usePriceFlash(price);
  return (
    <li
      data-testid={`watchlist-row-${ticker}`}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(ticker)}
      className={`group grid cursor-pointer grid-cols-[56px_1fr_56px_72px_16px] items-center gap-1.5 border-b border-line/60 py-1 pl-2 pr-1.5 text-[13px] hover:bg-raised ${
        selected ? "bg-raised shadow-[inset_2px_0_0_var(--color-accent)]" : ""
      }`}
    >
      <span className={`font-semibold ${selected ? "text-accent" : "text-ink"}`}>{ticker}</span>
      <span
        key={flash.key}
        data-testid={`price-${ticker}`}
        className={`num justify-self-end rounded-sm px-1 font-medium ${flash.cls}`}
      >
        {fmtPrice(price)}
      </span>
      <span className={`num justify-self-end text-xs ${toneClass(changePct)}`}>{fmtPct(changePct)}</span>
      <Sparkline points={history} width={72} />
      <button
        type="button"
        data-testid={`watchlist-remove-${ticker}`}
        aria-label={`Remove ${ticker} from watchlist`}
        title={`Remove ${ticker}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(ticker);
        }}
        className="h-4 w-4 leading-none text-faint opacity-60 hover:text-down group-hover:opacity-100 focus-visible:opacity-100"
      >
        ×
      </button>
    </li>
  );
}

interface WatchlistProps {
  items: WatchlistItem[];
  prices: PriceMap;
  history: PriceHistory;
  baseline: Record<string, number>;
  selected: string | null;
  onSelect: (ticker: string) => void;
  onAdd: (ticker: string) => Promise<void>;
  onRemove: (ticker: string) => Promise<void>;
}

/** Session change: live price vs. first price seen since page load. */
export function sessionChangePct(price: number | null, base: number | undefined, fallback: number | null): number | null {
  if (price !== null && base !== undefined && base !== 0) return ((price - base) / base) * 100;
  return fallback;
}

export default function Watchlist({ items, prices, history, baseline, selected, onSelect, onAdd, onRemove }: WatchlistProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ticker = input.trim().toUpperCase();
    if (!ticker) return;
    if (!TICKER_RE.test(ticker)) {
      setError("Use 1–10 letters, e.g. PYPL or BRK.B");
      return;
    }
    if (items.some((i) => i.ticker === ticker)) {
      setError(`${ticker} is already on your watchlist`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAdd(ticker);
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not add ${ticker}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (ticker: string) => {
    setError(null);
    try {
      await onRemove(ticker);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not remove ${ticker}`);
    }
  };

  return (
    <Panel title="Watchlist" right={<span className="num">{items.length}</span>} testId="watchlist" bodyClassName="flex flex-col">
      <div className="grid grid-cols-[56px_1fr_56px_72px_16px] gap-1.5 border-b border-line py-1 pl-2 pr-1.5 text-[11px] text-muted">
        <span>Symbol</span>
        <span className="justify-self-end">Last</span>
        <span className="justify-self-end" title="Change since this page loaded">Chg</span>
        <span>Trend</span>
        <span />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {items.length === 0 ? (
          <li className="px-3 py-4 text-sm text-muted">Your watchlist is empty. Add a symbol below to start streaming it.</li>
        ) : (
          items.map((item) => {
            const live = prices[item.ticker];
            const price = live?.price ?? item.price;
            return (
              <WatchlistRow
                key={item.ticker}
                ticker={item.ticker}
                price={price}
                changePct={sessionChangePct(price, baseline[item.ticker], live?.change_percent ?? item.change_percent)}
                history={history[item.ticker]}
                selected={selected === item.ticker}
                onSelect={onSelect}
                onRemove={remove}
              />
            );
          })
        )}
      </ul>
      <form onSubmit={submit} className="shrink-0 border-t border-line p-2">
        <div className="flex gap-1.5">
          <input
            data-testid="watchlist-add-input"
            value={input}
            onChange={(e) => {
              setInput(e.target.value.toUpperCase());
              setError(null);
            }}
            placeholder="Add symbol"
            aria-label="Symbol to add to watchlist"
            maxLength={10}
            className="min-w-0 flex-1 border border-line bg-canvas px-2 py-1 text-sm uppercase placeholder:normal-case placeholder:text-faint focus:border-blue focus:outline-none"
          />
          <button
            type="submit"
            data-testid="watchlist-add-button"
            disabled={busy || !input.trim()}
            className="border border-blue/60 px-3 py-1 text-sm font-medium text-blue hover:bg-blue/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-1.5 text-xs text-down">
            {error}
          </p>
        ) : null}
      </form>
    </Panel>
  );
}
