import { expect, test } from '@playwright/test';
import {
  ensureInWatchlist,
  flattenPosition,
  getHistory,
  getPortfolio,
  isFiniteNumber,
  Portfolio,
  quantityOf,
  trade,
  waitForPrice,
} from '../../helpers/api';

const TICKER = 'V';

function expectPortfolioShape(p: Portfolio) {
  for (const k of ['cash_balance', 'total_value', 'positions_value', 'unrealized_pnl'] as const) {
    expect(isFiniteNumber(p[k]), `${k} is a number`).toBe(true);
  }
  expect(Array.isArray(p.positions)).toBe(true);
  for (const pos of p.positions) {
    expect(Object.keys(pos)).toEqual(
      expect.arrayContaining([
        'ticker',
        'quantity',
        'avg_cost',
        'current_price',
        'market_value',
        'unrealized_pnl',
        'unrealized_pnl_percent',
        'weight',
      ]),
    );
    expect(pos.quantity).toBeGreaterThan(0);
  }
  // total = cash + positions (allow a cent of rounding)
  expect(Math.abs(p.total_value - (p.cash_balance + p.positions_value))).toBeLessThan(0.02);
}

test.describe('API: portfolio & trades @api', () => {
  test.beforeAll(async ({ request }) => {
    await ensureInWatchlist(request, TICKER);
    await waitForPrice(request, TICKER);
  });

  test('GET /api/portfolio has the contract shape and consistent totals', async ({ request }) => {
    const p = await getPortfolio(request);
    expectPortfolioShape(p);
    expect(p.cash_balance).toBeGreaterThanOrEqual(0);
  });

  test('buy then sell round trip updates cash, position, trade and history', async ({ request }) => {
    await flattenPosition(request, TICKER);
    const before = await getPortfolio(request);
    const histBefore = (await getHistory(request)).length;

    const buy = await trade(request, TICKER, 'buy', 2);
    expect(Object.keys(buy.trade)).toEqual(
      expect.arrayContaining(['id', 'ticker', 'side', 'quantity', 'price', 'executed_at']),
    );
    expect(buy.trade.ticker).toBe(TICKER);
    expect(buy.trade.side).toBe('buy');
    expect(buy.trade.quantity).toBe(2);
    expect(buy.trade.price).toBeGreaterThan(0);
    expectPortfolioShape(buy.portfolio);
    expect(buy.portfolio.cash_balance).toBeCloseTo(before.cash_balance - 2 * buy.trade.price, 2);
    expect(quantityOf(buy.portfolio, TICKER)).toBe(2);
    const pos = buy.portfolio.positions.find((x) => x.ticker === TICKER)!;
    expect(pos.avg_cost).toBeCloseTo(buy.trade.price, 2);

    // GET reflects the trade too
    expect(quantityOf(await getPortfolio(request), TICKER)).toBe(2);

    // Snapshot recorded immediately after a trade
    expect((await getHistory(request)).length).toBeGreaterThan(histBefore);

    const sell1 = await trade(request, TICKER, 'sell', 1);
    expect(sell1.trade.side).toBe('sell');
    expect(sell1.portfolio.cash_balance).toBeCloseTo(buy.portfolio.cash_balance + sell1.trade.price, 2);
    expect(quantityOf(sell1.portfolio, TICKER)).toBe(1);

    const sell2 = await trade(request, TICKER, 'sell', 1);
    expect(sell2.portfolio.positions.find((x) => x.ticker === TICKER), 'position row removed at 0').toBeUndefined();
  });

  test('fractional quantities are supported', async ({ request }) => {
    await flattenPosition(request, TICKER);
    const buy = await trade(request, TICKER, 'buy', 0.5);
    expect(quantityOf(buy.portfolio, TICKER)).toBeCloseTo(0.5, 6);
    const sell = await trade(request, TICKER, 'sell', 0.5);
    expect(quantityOf(sell.portfolio, TICKER)).toBe(0);
  });

  test('ticker in trade request is upper-cased', async ({ request }) => {
    await flattenPosition(request, TICKER);
    const res = await request.post('/api/portfolio/trade', {
      data: { ticker: TICKER.toLowerCase(), side: 'buy', quantity: 1 },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).trade.ticker).toBe(TICKER);
    await flattenPosition(request, TICKER);
  });

  test.describe('trade validation errors return 400 with detail and do not change state', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['selling more than owned', { ticker: TICKER, side: 'sell', quantity: 1_000_000 }],
      ['insufficient cash', { ticker: TICKER, side: 'buy', quantity: 1_000_000_000 }],
      ['zero quantity', { ticker: TICKER, side: 'buy', quantity: 0 }],
      ['negative quantity', { ticker: TICKER, side: 'buy', quantity: -5 }],
      ['ticker without a price', { ticker: 'ZZZZQ', side: 'buy', quantity: 1 }],
    ];
    for (const [name, body] of cases) {
      test(name, async ({ request }) => {
        const before = await getPortfolio(request);
        const res = await request.post('/api/portfolio/trade', { data: body });
        expect(res.status(), await res.text()).toBe(400);
        expect(typeof (await res.json()).detail).toBe('string');
        const after = await getPortfolio(request);
        expect(after.cash_balance).toBeCloseTo(before.cash_balance, 2);
        expect(quantityOf(after, TICKER)).toBe(quantityOf(before, TICKER));
      });
    }

    test('invalid side / malformed body is rejected with 400', async ({ request }) => {
      const r1 = await request.post('/api/portfolio/trade', { data: { ticker: TICKER, side: 'hold', quantity: 1 } });
      expect(r1.status()).toBe(400);
      const r2 = await request.post('/api/portfolio/trade', { data: { ticker: TICKER } });
      expect(r2.status()).toBe(400);
    });
  });

  test('GET /api/portfolio/history returns snapshots oldest -> newest', async ({ request }) => {
    const hist = await getHistory(request);
    expect(Array.isArray(hist)).toBe(true);
    expect(hist.length).toBeGreaterThan(0);
    for (const s of hist) {
      expect(isFiniteNumber(s.total_value)).toBe(true);
      expect(typeof s.recorded_at).toBe('string');
      expect(Number.isNaN(Date.parse(s.recorded_at))).toBe(false);
    }
    for (let i = 1; i < hist.length; i++) {
      expect(Date.parse(hist[i].recorded_at)).toBeGreaterThanOrEqual(Date.parse(hist[i - 1].recorded_at));
    }
  });
});
