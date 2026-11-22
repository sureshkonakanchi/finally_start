import { expect, test } from '@playwright/test';
import { DEFAULT_TICKERS, getPortfolio, getWatchlist, STARTING_CASH } from '../helpers/api';
import { openApp, readMoney, tid, waitForMoney } from '../helpers/ui';

/**
 * Runs first (file name sorts first, workers=1). When the suite is pointed at a
 * freshly-seeded database set E2E_FRESH_DB=true so the $10,000 assertion is strict;
 * otherwise the header is checked for consistency with /api/portfolio.
 */
const FRESH = process.env.E2E_FRESH_DB === 'true';

test.describe('Fresh start', () => {
  test('default watchlist, $10k cash, live prices, connected indicator', async ({ page, request }) => {
    await openApp(page);

    // 10 default tickers, each with a rendered price
    for (const t of DEFAULT_TICKERS) {
      await expect(tid(page, `watchlist-row-${t}`), `row for ${t}`).toBeVisible();
      await waitForMoney(tid(page, `price-${t}`));
    }

    // Cash + total value in header
    const cash = await waitForMoney(tid(page, 'header-cash'));
    const total = await waitForMoney(tid(page, 'header-total-value'));
    if (FRESH) {
      expect(cash).toBeCloseTo(STARTING_CASH, 2);
      expect(total).toBeCloseTo(STARTING_CASH, 0);
      const p = await getPortfolio(request);
      expect(p.positions).toHaveLength(0);
      expect((await getWatchlist(request)).map((w) => w.ticker).sort()).toEqual([...DEFAULT_TICKERS].sort());
    } else {
      const p = await getPortfolio(request);
      expect(cash).toBeCloseTo(p.cash_balance, 0);
    }

    await expect(tid(page, 'connection-status')).toHaveAttribute('data-status', 'connected');
  });

  test('prices stream: at least one watchlist price changes within 10s', async ({ page }) => {
    await openApp(page);
    const snapshot = async () => {
      const out: Record<string, string> = {};
      for (const t of DEFAULT_TICKERS) out[t] = await tid(page, `price-${t}`).innerText();
      return out;
    };
    const first = await snapshot();
    await expect
      .poll(
        async () => {
          const now = await snapshot();
          return DEFAULT_TICKERS.filter((t) => now[t] !== first[t]).length;
        },
        { timeout: 10_000, message: 'no price changed in the UI — SSE stream not reaching the page?' },
      )
      .toBeGreaterThan(0);
  });

  test('main layout panels are present', async ({ page }) => {
    await openApp(page);
    for (const id of ['main-chart', 'positions-table', 'chat-panel', 'heatmap', 'pnl-chart']) {
      await expect(tid(page, id), id).toBeVisible();
    }
  });

  test('clicking a watchlist row keeps the main chart rendered', async ({ page }) => {
    await openApp(page);
    await tid(page, 'watchlist-row-MSFT').click();
    await expect(tid(page, 'main-chart')).toBeVisible();
    await expect(tid(page, 'main-chart')).toContainText('MSFT');
  });

  test('header total value is a positive number', async ({ page }) => {
    await openApp(page);
    expect(await readMoney(tid(page, 'header-total-value'))).toBeGreaterThan(0);
  });
});
