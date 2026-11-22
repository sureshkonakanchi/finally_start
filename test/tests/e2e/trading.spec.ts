import { expect, test } from '@playwright/test';
import {
  ensureInWatchlist,
  flattenPosition,
  getPortfolio,
  quantityOf,
  trade,
  waitForPrice,
} from '../../helpers/api';
import { openApp, placeTrade, readMoney, tid, waitForMoney } from '../../helpers/ui';

test.describe('Trading UI', () => {
  test('buy shares: cash decreases, position appears, portfolio updates', async ({ page, request }) => {
    const T = 'MSFT';
    await ensureInWatchlist(request, T);
    const price = await waitForPrice(request, T);
    await flattenPosition(request, T);

    await openApp(page);
    await expect(tid(page, `position-row-${T}`)).toHaveCount(0);
    const cashBefore = await waitForMoney(tid(page, 'header-cash'));

    await placeTrade(page, T, 3, 'buy');

    await expect(tid(page, `position-row-${T}`)).toBeVisible();
    await expect(tid(page, `position-row-${T}`)).toContainText('3');
    await expect
      .poll(() => readMoney(tid(page, 'header-cash')), { message: 'header cash should drop by ~3 x price' })
      .toBeLessThan(cashBefore - 3 * price * 0.8);

    const p = await getPortfolio(request);
    expect(quantityOf(p, T)).toBe(3);
    expect(await readMoney(tid(page, 'header-cash'))).toBeCloseTo(p.cash_balance, 0);
    await expect(tid(page, 'trade-error')).toHaveCount(0);
  });

  test('sell shares: cash increases, position updates, then disappears', async ({ page, request }) => {
    const T = 'JPM';
    await ensureInWatchlist(request, T);
    await waitForPrice(request, T);
    await flattenPosition(request, T);
    await trade(request, T, 'buy', 2);

    await openApp(page);
    await expect(tid(page, `position-row-${T}`)).toBeVisible();
    const cashBefore = await waitForMoney(tid(page, 'header-cash'));

    await placeTrade(page, T, 1, 'sell');
    await expect.poll(() => readMoney(tid(page, 'header-cash'))).toBeGreaterThan(cashBefore);
    await expect.poll(async () => quantityOf(await getPortfolio(request), T)).toBe(1);
    await expect(tid(page, `position-row-${T}`)).toBeVisible();

    const cashMid = await readMoney(tid(page, 'header-cash'));
    await placeTrade(page, T, 1, 'sell');
    await expect(tid(page, `position-row-${T}`)).toHaveCount(0);
    await expect.poll(() => readMoney(tid(page, 'header-cash'))).toBeGreaterThan(cashMid);
    expect(quantityOf(await getPortfolio(request), T)).toBe(0);
  });

  test('selling more than owned shows a trade error and changes nothing', async ({ page, request }) => {
    const T = 'NFLX';
    await ensureInWatchlist(request, T);
    await waitForPrice(request, T);
    await flattenPosition(request, T);

    await openApp(page);
    const before = await getPortfolio(request);
    await placeTrade(page, T, 5, 'sell');
    await expect(tid(page, 'trade-error')).toBeVisible();
    await expect(tid(page, 'trade-error')).not.toBeEmpty();
    const after = await getPortfolio(request);
    expect(after.cash_balance).toBeCloseTo(before.cash_balance, 2);
    await expect(tid(page, `position-row-${T}`)).toHaveCount(0);
  });

  test('buying with insufficient cash shows a trade error', async ({ page, request }) => {
    await openApp(page);
    const before = await getPortfolio(request);
    await placeTrade(page, 'NVDA', 10_000_000, 'buy');
    await expect(tid(page, 'trade-error')).toBeVisible();
    expect((await getPortfolio(request)).cash_balance).toBeCloseTo(before.cash_balance, 2);
  });
});
