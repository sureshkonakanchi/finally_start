import { expect, test } from '@playwright/test';
import { ensureNotInWatchlist, getPortfolio, getWatchlist, waitForPrice } from '../../helpers/api';
import { openApp, sendChat, tid } from '../../helpers/ui';

/** Requires LLM_MOCK=true on the backend. */
test.describe('AI chat (mocked LLM)', () => {
  test.afterAll(async ({ request }) => {
    await ensureNotInWatchlist(request, 'PYPL');
  });

  test('send a message and get an assistant reply', async ({ page }) => {
    await openApp(page);
    const before = await tid(page, 'chat-message').count();
    await sendChat(page, 'hello, how is my portfolio?');
    await expect.poll(() => tid(page, 'chat-message').count()).toBeGreaterThanOrEqual(before + 2);
    await expect(tid(page, 'chat-message').last()).not.toBeEmpty();
    await expect(tid(page, 'chat-loading')).toHaveCount(0);
    await expect(tid(page, 'chat-input')).toHaveValue('');
  });

  test('shows a loading indicator while waiting for the reply', async ({ page }) => {
    await openApp(page);
    // Delay the chat response so the indicator is observable.
    await page.route('**/api/chat', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await sendChat(page, 'thinking test');
    await expect(tid(page, 'chat-loading')).toBeVisible();
    await expect(tid(page, 'chat-loading')).toHaveCount(0, { timeout: 15_000 });
  });

  test('"buy" message executes a trade shown inline and updates the portfolio', async ({ page, request }) => {
    await waitForPrice(request, 'AAPL');
    await openApp(page);
    const before = await getPortfolio(request);
    const actionsBefore = await tid(page, 'chat-action').count();

    await sendChat(page, 'buy some AAPL for me');

    await expect.poll(() => tid(page, 'chat-action').count()).toBeGreaterThan(actionsBefore);
    const action = tid(page, 'chat-action').last();
    await expect(action).toContainText(/buy|bought/i);
    await expect(action).toContainText('AAPL');

    await expect
      .poll(async () => (await getPortfolio(request)).cash_balance, { message: 'cash should drop after chat buy' })
      .toBeLessThan(before.cash_balance);
    await expect(tid(page, 'position-row-AAPL')).toBeVisible();
  });

  test('"add PYPL" updates the watchlist and shows an inline confirmation', async ({ page, request }) => {
    await ensureNotInWatchlist(request, 'PYPL');
    await openApp(page);
    await expect(tid(page, 'watchlist-row-PYPL')).toHaveCount(0);
    const actionsBefore = await tid(page, 'chat-action').count();

    await sendChat(page, 'add PYPL');

    await expect.poll(() => tid(page, 'chat-action').count()).toBeGreaterThan(actionsBefore);
    await expect(tid(page, 'chat-action').last()).toContainText('PYPL');
    await expect(tid(page, 'watchlist-row-PYPL')).toBeVisible();
    expect((await getWatchlist(request)).map((w) => w.ticker)).toContain('PYPL');
  });

  test('conversation history is restored after reload', async ({ page }) => {
    const marker = `persist-${Date.now()}`;
    await openApp(page);
    await sendChat(page, marker);
    await expect(tid(page, 'chat-panel')).toContainText(marker);
    await page.reload();
    await expect(tid(page, 'chat-panel')).toContainText(marker, { timeout: 15_000 });
  });
});
