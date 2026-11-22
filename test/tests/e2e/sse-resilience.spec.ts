import { expect, Route, test } from '@playwright/test';
import { getWatchlist } from '../../helpers/api';
import { openApp, tid } from '../../helpers/ui';

const STREAM = '**/api/stream/prices';

test.describe('SSE resilience', () => {
  test('stream drops -> indicator leaves "connected" -> stream restored -> reconnects and prices resume', async ({
    page,
    request,
  }) => {
    // Build a valid single-event payload from current prices.
    const wl = await getWatchlist(request);
    const payload: Record<string, unknown> = {};
    for (const w of wl) {
      if (w.price == null) continue;
      payload[w.ticker] = {
        ticker: w.ticker,
        price: w.price,
        previous_price: w.previous_price ?? w.price,
        timestamp: Date.now() / 1000,
        change: 0,
        change_percent: 0,
        direction: 'flat',
      };
    }

    // Phase 1: the first connection gets a finite stream (server "drops" after one event).
    // Phase 2: reconnect attempts fail with a network error.
    // Phase 3: traffic passes through to the real backend.
    let mode: 'drop' | 'block' | 'pass' = 'drop';
    let attemptsWhileBlocked = 0;
    await page.route(STREAM, async (route: Route) => {
      if (mode === 'drop') {
        mode = 'block';
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
          body: `retry: 1000\ndata: ${JSON.stringify(payload)}\n\n`,
        });
      } else if (mode === 'block') {
        attemptsWhileBlocked++;
        await route.abort('internetdisconnected');
      } else {
        await route.continue();
      }
    });

    await openApp(page, { waitConnected: false });
    const status = tid(page, 'connection-status');

    // After the drop the indicator must not claim "connected".
    await expect(status).toHaveAttribute('data-status', /reconnecting|disconnected/, { timeout: 15_000 });
    // The client keeps retrying on its own.
    await expect.poll(() => attemptsWhileBlocked, { timeout: 15_000 }).toBeGreaterThan(0);

    // Restore the network: it must come back without a page reload.
    mode = 'pass';
    await expect(status).toHaveAttribute('data-status', 'connected', { timeout: 30_000 });

    // Prices resume updating after the reconnect.
    const readAll = () => Promise.all(wl.map((w) => tid(page, `price-${w.ticker}`).innerText()));
    const afterReconnect = await readAll();
    await expect
      .poll(async () => (await readAll()).filter((txt, i) => txt !== afterReconnect[i]).length, {
        timeout: 15_000,
        message: 'prices did not resume updating after reconnect',
      })
      .toBeGreaterThan(0);
  });

  test('backend unreachable on load shows a non-connected status, then connects once available', async ({ page }) => {
    let blocked = true;
    await page.route(STREAM, (route) => (blocked ? route.abort('connectionrefused') : route.continue()));
    await openApp(page, { waitConnected: false });
    const status = tid(page, 'connection-status');
    await expect(status).toHaveAttribute('data-status', /reconnecting|disconnected/, { timeout: 15_000 });
    blocked = false;
    await expect(status).toHaveAttribute('data-status', 'connected', { timeout: 30_000 });
  });
});
