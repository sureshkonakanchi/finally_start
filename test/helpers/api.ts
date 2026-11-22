import { APIRequestContext, expect } from '@playwright/test';

export const DEFAULT_TICKERS = [
  'AAPL',
  'GOOGL',
  'MSFT',
  'AMZN',
  'TSLA',
  'NVDA',
  'META',
  'JPM',
  'V',
  'NFLX',
] as const;

export const STARTING_CASH = 10_000;

export interface WatchlistItem {
  ticker: string;
  price: number | null;
  previous_price: number | null;
  change: number | null;
  change_percent: number | null;
  direction: string | null;
}

export interface Position {
  ticker: string;
  quantity: number;
  avg_cost: number;
  current_price: number | null;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pnl_percent: number;
  weight: number;
}

export interface Portfolio {
  cash_balance: number;
  total_value: number;
  positions_value: number;
  unrealized_pnl: number;
  positions: Position[];
}

export interface Trade {
  id: number | string;
  ticker: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  executed_at: string;
}

export interface TradeResponse {
  trade: Trade;
  portfolio: Portfolio;
}

export interface Snapshot {
  total_value: number;
  recorded_at: string;
}

export interface ChatResponse {
  message: string;
  trades: Array<{
    ticker: string;
    side: string;
    quantity: number;
    price?: number;
    status: 'executed' | 'failed';
    error?: string;
  }>;
  watchlist_changes: Array<{
    ticker: string;
    action: 'add' | 'remove';
    status: string;
    error?: string;
  }>;
}

export async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(path);
  expect(res.status(), `GET ${path} status`).toBe(200);
  return (await res.json()) as T;
}

export const getPortfolio = (r: APIRequestContext) => getJson<Portfolio>(r, '/api/portfolio');
export const getWatchlist = (r: APIRequestContext) => getJson<WatchlistItem[]>(r, '/api/watchlist');
export const getHistory = (r: APIRequestContext) => getJson<Snapshot[]>(r, '/api/portfolio/history');

export function positionOf(p: Portfolio, ticker: string): Position | undefined {
  return p.positions.find((x) => x.ticker === ticker);
}

export function quantityOf(p: Portfolio, ticker: string): number {
  return positionOf(p, ticker)?.quantity ?? 0;
}

/** Make sure a ticker is on the watchlist (ignores 409). */
export async function ensureInWatchlist(request: APIRequestContext, ticker: string): Promise<void> {
  const res = await request.post('/api/watchlist', { data: { ticker } });
  expect([201, 409], `ensureInWatchlist(${ticker}) status`).toContain(res.status());
}

/** Make sure a ticker is NOT on the watchlist (ignores 404). */
export async function ensureNotInWatchlist(request: APIRequestContext, ticker: string): Promise<void> {
  const res = await request.delete(`/api/watchlist/${ticker}`);
  expect([200, 404], `ensureNotInWatchlist(${ticker}) status`).toContain(res.status());
}

/** Wait until the backend has a price for a ticker (simulator needs a tick after an add). */
export async function waitForPrice(request: APIRequestContext, ticker: string, timeoutMs = 15_000): Promise<number> {
  let price: number | null = null;
  await expect
    .poll(
      async () => {
        const wl = await getWatchlist(request);
        price = wl.find((w) => w.ticker === ticker)?.price ?? null;
        return price;
      },
      { timeout: timeoutMs, message: `price for ${ticker} never appeared in /api/watchlist` },
    )
    .not.toBeNull();
  return price as unknown as number;
}

export async function trade(
  request: APIRequestContext,
  ticker: string,
  side: 'buy' | 'sell',
  quantity: number,
): Promise<TradeResponse> {
  const res = await request.post('/api/portfolio/trade', { data: { ticker, side, quantity } });
  expect(res.status(), `trade ${side} ${quantity} ${ticker}: ${await res.text()}`).toBe(200);
  return (await res.json()) as TradeResponse;
}

/** Sell any holdings of ticker so the test starts from zero shares. */
export async function flattenPosition(request: APIRequestContext, ticker: string): Promise<void> {
  const qty = quantityOf(await getPortfolio(request), ticker);
  if (qty > 0) await trade(request, ticker, 'sell', qty);
}

/** Parse "$10,000.00", "10000", "-$12.34" etc. into a number. */
export function parseMoney(text: string | null | undefined): number {
  const cleaned = (text ?? '').replace(/[^0-9.\-]/g, '');
  const n = Number.parseFloat(cleaned);
  if (Number.isNaN(n)) throw new Error(`Could not parse a number from "${text}"`);
  return n;
}

export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
