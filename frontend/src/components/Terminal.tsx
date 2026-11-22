"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ChatPanel from "./ChatPanel";
import Header from "./Header";
import Heatmap from "./Heatmap";
import Panel from "./Panel";
import PositionsTable from "./PositionsTable";
import TimeSeriesChart from "./TimeSeriesChart";
import TradeBar from "./TradeBar";
import Watchlist from "./Watchlist";
import { usePriceStream, type PricePoint } from "@/hooks/usePriceStream";
import { api } from "@/lib/api";
import { fmtPct, fmtPrice, fmtSignedUsd, toUnixSeconds, toneClass } from "@/lib/format";
import { computeLivePortfolio } from "@/lib/portfolio";
import type { Portfolio, Snapshot, WatchlistItem } from "@/lib/types";

const PORTFOLIO_POLL_MS = 15_000;
const HISTORY_POLL_MS = 30_000;

/** Snapshots → chart points (one per second, ascending), with an optional live tail point. */
export function snapshotsToPoints(snaps: Snapshot[], liveTotal?: number | null, now = Date.now() / 1000): PricePoint[] {
  const pts: PricePoint[] = [];
  for (const s of [...snaps].sort((a, b) => toUnixSeconds(a.recorded_at) - toUnixSeconds(b.recorded_at))) {
    const t = Math.floor(toUnixSeconds(s.recorded_at));
    const last = pts[pts.length - 1];
    if (last && last.time === t) last.value = s.total_value;
    else if (!last || t > last.time) pts.push({ time: t, value: s.total_value });
  }
  if (liveTotal !== null && liveTotal !== undefined && pts.length) {
    const t = Math.floor(now);
    const last = pts[pts.length - 1];
    if (t > last.time) pts.push({ time: t, value: liveTotal });
  }
  return pts;
}

export default function Terminal() {
  const { prices, history, baseline, status } = usePriceStream();
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshWatchlist = useCallback(async () => {
    try {
      const items = await api.getWatchlist();
      setWatchlist(items);
      setSelected((cur) => (cur && items.some((i) => i.ticker === cur) ? cur : (items[0]?.ticker ?? cur)));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load watchlist");
    }
  }, []);

  const refreshPortfolio = useCallback(async () => {
    try {
      setPortfolio(await api.getPortfolio());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load portfolio");
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      setSnapshots(await api.getHistory());
    } catch {
      /* keep the last good history */
    }
  }, []);

  useEffect(() => {
    refreshWatchlist();
    refreshPortfolio();
    refreshHistory();
    const p = setInterval(refreshPortfolio, PORTFOLIO_POLL_MS);
    const h = setInterval(refreshHistory, HISTORY_POLL_MS);
    return () => {
      clearInterval(p);
      clearInterval(h);
    };
  }, [refreshWatchlist, refreshPortfolio, refreshHistory]);

  const live = useMemo(() => computeLivePortfolio(portfolio, prices), [portfolio, prices]);

  const onTrade = useCallback(
    async (ticker: string, quantity: number, side: "buy" | "sell") => {
      const res = await api.trade(ticker, quantity, side);
      setPortfolio(res.portfolio);
      refreshHistory();
      return res.trade;
    },
    [refreshHistory],
  );

  const onAdd = useCallback(
    async (ticker: string) => {
      await api.addWatchlist(ticker);
      setSelected(ticker);
      await refreshWatchlist();
    },
    [refreshWatchlist],
  );

  const onRemove = useCallback(
    async (ticker: string) => {
      await api.removeWatchlist(ticker);
      await refreshWatchlist();
    },
    [refreshWatchlist],
  );

  const onChatActions = useCallback(() => {
    refreshPortfolio();
    refreshWatchlist();
    refreshHistory();
  }, [refreshPortfolio, refreshWatchlist, refreshHistory]);

  const selectedPrice = selected ? (prices[selected]?.price ?? watchlist.find((w) => w.ticker === selected)?.price ?? null) : null;
  const selectedBase = selected ? baseline[selected] : undefined;
  const selectedChg = selectedPrice !== null && selectedBase ? ((selectedPrice - selectedBase) / selectedBase) * 100 : null;
  const mainData = useMemo(() => (selected ? (history[selected] ?? []) : []), [history, selected]);
  const pnlData = useMemo(
    () => snapshotsToPoints(snapshots, portfolio ? live.totalValue : null),
    [snapshots, portfolio, live.totalValue],
  );
  const sessionPnl = pnlData.length ? live.totalValue - pnlData[0].value : null;

  return (
    <div className="flex h-screen min-h-[640px] flex-col overflow-hidden">
      <Header
        totalValue={portfolio ? live.totalValue : null}
        cash={portfolio ? live.cash : null}
        unrealizedPnl={portfolio ? live.unrealizedPnl : null}
        costBasis={live.costBasis}
        status={status}
      />
      {loadError ? (
        <div role="alert" className="shrink-0 border-b border-down/40 bg-down/10 px-4 py-1 text-xs text-down">
          {loadError}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <main className="grid min-h-0 min-w-0 flex-1 grid-cols-[300px_minmax(0,1fr)] gap-px bg-line max-lg:grid-cols-[260px_minmax(0,1fr)]">
          <Watchlist
            items={watchlist}
            prices={prices}
            history={history}
            baseline={baseline}
            selected={selected}
            onSelect={setSelected}
            onAdd={onAdd}
            onRemove={onRemove}
          />
          <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,0.8fr)] gap-px">
            <Panel
              title={
                <span className="flex items-baseline gap-3">
                  <span className="text-accent">{selected ?? "No symbol selected"}</span>
                  <span className="num text-base">{fmtPrice(selectedPrice)}</span>
                  <span className={`num text-xs font-normal ${toneClass(selectedChg)}`}>{fmtPct(selectedChg)} this session</span>
                </span>
              }
              bodyClassName="flex flex-col"
            >
              <div className="min-h-0 flex-1">
                <TimeSeriesChart
                  testId="main-chart"
                  data={mainData}
                  color="#209dd7"
                  emptyText={selected ? `Collecting ${selected} prices…` : "Select a symbol in the watchlist"}
                />
              </div>
              <TradeBar ticker={selected} price={selectedPrice} onTrade={onTrade} />
            </Panel>
            <div className="grid min-h-0 grid-cols-2 gap-px">
              <Panel title="Holdings heatmap" right={<span>size = weight, color = P&amp;L</span>}>
                <Heatmap positions={live.positions} onSelect={setSelected} />
              </Panel>
              <Panel
                title="Portfolio value"
                right={
                  sessionPnl !== null ? <span className={`num ${toneClass(sessionPnl)}`}>{fmtSignedUsd(sessionPnl)} over period</span> : null
                }
              >
                <TimeSeriesChart testId="pnl-chart" data={pnlData} color="#ecad0a" showSeconds={false} emptyText="Value history appears after the first snapshot" />
              </Panel>
            </div>
            <Panel title="Positions" right={<span className="num">{live.positions.length}</span>}>
              <PositionsTable positions={live.positions} onSelect={setSelected} />
            </Panel>
          </div>
        </main>
        <ChatPanel collapsed={chatCollapsed} onToggle={() => setChatCollapsed((c) => !c)} onActions={onChatActions} />
      </div>
    </div>
  );
}
