import { expect, test } from '@playwright/test';
import { ensureNotInWatchlist, getWatchlist } from '../../helpers/api';
import { openApp, tid, waitForMoney } from '../../helpers/ui';

const TICKER = 'DIS';

test.describe('Watchlist UI', () => {
  test.beforeEach(async ({ request }) => {
    await ensureNotInWatchlist(request, TICKER);
  });
  test.afterAll(async ({ request }) => {
    await ensureNotInWatchlist(request, TICKER);
  });

  test('add a ticker, see it stream, then remove it', async ({ page, request }) => {
    await openApp(page);
    await expect(tid(page, `watchlist-row-${TICKER}`)).toHaveCount(0);

    await tid(page, 'watchlist-add-input').fill(TICKER.toLowerCase());
    await tid(page, 'watchlist-add-button').click();

    await expect(tid(page, `watchlist-row-${TICKER}`)).toBeVisible();
    await waitForMoney(tid(page, `price-${TICKER}`), 20_000);
    expect((await getWatchlist(request)).map((w) => w.ticker)).toContain(TICKER);

    // persists across reload
    await page.reload();
    await expect(tid(page, `watchlist-row-${TICKER}`)).toBeVisible();

    await tid(page, `watchlist-remove-${TICKER}`).click();
    await expect(tid(page, `watchlist-row-${TICKER}`)).toHaveCount(0);
    expect((await getWatchlist(request)).map((w) => w.ticker)).not.toContain(TICKER);

    await page.reload();
    await expect(tid(page, 'watchlist-row-AAPL')).toBeVisible();
    await expect(tid(page, `watchlist-row-${TICKER}`)).toHaveCount(0);
  });

  test('adding a duplicate ticker does not create a second row', async ({ page }) => {
    await openApp(page);
    await tid(page, 'watchlist-add-input').fill('AAPL');
    await tid(page, 'watchlist-add-button').click();
    await page.waitForTimeout(1000);
    await expect(tid(page, 'watchlist-row-AAPL')).toHaveCount(1);
  });

  test('adding an invalid ticker does not add a row', async ({ page }) => {
    await openApp(page);
    const before = await page.locator('[data-testid^="watchlist-row-"]').count();
    await tid(page, 'watchlist-add-input').fill('12$$');
    await tid(page, 'watchlist-add-button').click();
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid^="watchlist-row-"]')).toHaveCount(before);
  });
});
