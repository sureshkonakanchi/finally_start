import { expect, test } from '@playwright/test';
import {
  DEFAULT_TICKERS,
  ensureInWatchlist,
  ensureNotInWatchlist,
  getWatchlist,
  isFiniteNumber,
  waitForPrice,
} from '../../helpers/api';

const TICKER = 'SBUX';

test.describe('API: watchlist @api', () => {
  test.afterAll(async ({ request }) => {
    await ensureNotInWatchlist(request, TICKER);
    await ensureNotInWatchlist(request, 'KO');
  });

  test('GET /api/watchlist returns items with the contract shape', async ({ request }) => {
    const res = await request.get('/api/watchlist');
    expect(res.status()).toBe(200);
    const items = await res.json();
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(Object.keys(item)).toEqual(
        expect.arrayContaining(['ticker', 'price', 'previous_price', 'change', 'change_percent', 'direction']),
      );
      expect(item.ticker).toMatch(/^[A-Z.]{1,10}$/);
      expect(item.price === null || isFiniteNumber(item.price)).toBe(true);
    }
    // Default tickers are never removed by this suite.
    const tickers = items.map((i: { ticker: string }) => i.ticker);
    for (const t of DEFAULT_TICKERS) expect(tickers).toContain(t);
  });

  test('POST adds a ticker (201), duplicate is 409, DELETE removes (200), second DELETE is 404', async ({
    request,
  }) => {
    await ensureNotInWatchlist(request, TICKER);

    const add = await request.post('/api/watchlist', { data: { ticker: TICKER } });
    expect(add.status()).toBe(201);
    const body = await add.json();
    expect(body.ticker).toBe(TICKER);
    expect(body).toHaveProperty('price');

    expect((await getWatchlist(request)).map((w) => w.ticker)).toContain(TICKER);
    // A newly added ticker must start getting prices from the market source.
    const price = await waitForPrice(request, TICKER);
    expect(price).toBeGreaterThan(0);

    const dup = await request.post('/api/watchlist', { data: { ticker: TICKER } });
    expect(dup.status()).toBe(409);
    expect(await dup.json()).toHaveProperty('detail');

    const del = await request.delete(`/api/watchlist/${TICKER}`);
    expect(del.status()).toBe(200);
    expect((await del.json()).ticker).toBe(TICKER);
    expect((await getWatchlist(request)).map((w) => w.ticker)).not.toContain(TICKER);

    const del2 = await request.delete(`/api/watchlist/${TICKER}`);
    expect(del2.status()).toBe(404);
    expect(await del2.json()).toHaveProperty('detail');
  });

  test('tickers are upper-cased server-side', async ({ request }) => {
    await ensureNotInWatchlist(request, 'KO');
    const add = await request.post('/api/watchlist', { data: { ticker: 'ko' } });
    expect(add.status()).toBe(201);
    expect((await add.json()).ticker).toBe('KO');
    expect((await getWatchlist(request)).map((w) => w.ticker)).toContain('KO');
    const del = await request.delete('/api/watchlist/ko');
    expect(del.status()).toBe(200);
    expect((await getWatchlist(request)).map((w) => w.ticker)).not.toContain('KO');
  });

  for (const bad of ['', '123', 'ABCDEFGHIJK', 'AA PL', 'A$B']) {
    test(`POST with invalid ticker ${JSON.stringify(bad)} is 400`, async ({ request }) => {
      const res = await request.post('/api/watchlist', { data: { ticker: bad } });
      expect(res.status()).toBe(400);
      expect(await res.json()).toHaveProperty('detail');
    });
  }

  test('POST with missing ticker field is rejected with 400', async ({ request }) => {
    const res = await request.post('/api/watchlist', { data: {} });
    expect(res.status()).toBe(400);
  });

  test('re-adding an existing default ticker is 409', async ({ request }) => {
    await ensureInWatchlist(request, 'AAPL');
    const res = await request.post('/api/watchlist', { data: { ticker: 'AAPL' } });
    expect(res.status()).toBe(409);
  });
});
