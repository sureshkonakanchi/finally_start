import { expect, test } from '@playwright/test';
import {
  ChatResponse,
  ensureNotInWatchlist,
  getPortfolio,
  getWatchlist,
  quantityOf,
  waitForPrice,
} from '../../helpers/api';

/** Requires the backend to run with LLM_MOCK=true. */
test.describe('API: chat (LLM_MOCK=true) @api', () => {
  test.afterAll(async ({ request }) => {
    await ensureNotInWatchlist(request, 'PYPL');
  });

  test('plain message returns the contract shape with no actions', async ({ request }) => {
    const res = await request.post('/api/chat', { data: { message: 'hello there' } });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as ChatResponse;
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
    expect(Array.isArray(body.trades)).toBe(true);
    expect(Array.isArray(body.watchlist_changes)).toBe(true);
    expect(body.trades).toHaveLength(0);
    expect(body.watchlist_changes).toHaveLength(0);
  });

  test('"buy" message executes a trade through the portfolio service', async ({ request }) => {
    await waitForPrice(request, 'AAPL');
    const before = await getPortfolio(request);
    const res = await request.post('/api/chat', { data: { message: 'please buy some apple' } });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as ChatResponse;
    expect(body.trades.length).toBeGreaterThanOrEqual(1);
    const t = body.trades[0];
    expect(t.side).toBe('buy');
    expect(t.status).toBe('executed');
    expect(t.quantity).toBeGreaterThan(0);
    const after = await getPortfolio(request);
    expect(quantityOf(after, t.ticker)).toBeCloseTo(quantityOf(before, t.ticker) + t.quantity, 6);
    expect(after.cash_balance).toBeLessThan(before.cash_balance);
  });

  test('"add PYPL" message adds to the watchlist', async ({ request }) => {
    await ensureNotInWatchlist(request, 'PYPL');
    const res = await request.post('/api/chat', { data: { message: 'add PYPL' } });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as ChatResponse;
    const change = body.watchlist_changes.find((c) => c.ticker === 'PYPL');
    expect(change, JSON.stringify(body)).toBeDefined();
    expect(change!.action).toBe('add');
    expect(change!.status).not.toMatch(/fail/i);
    expect((await getWatchlist(request)).map((w) => w.ticker)).toContain('PYPL');
  });

  test('"buy 2 TSLA" buys the requested quantity and ticker', async ({ request }) => {
    await waitForPrice(request, 'TSLA');
    const before = quantityOf(await getPortfolio(request), 'TSLA');
    const res = await request.post('/api/chat', { data: { message: 'buy 2 TSLA' } });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as ChatResponse;
    expect(body.trades).toHaveLength(1);
    expect(body.trades[0]).toMatchObject({ ticker: 'TSLA', side: 'buy', quantity: 2, status: 'executed' });
    expect(quantityOf(await getPortfolio(request), 'TSLA')).toBeCloseTo(before + 2, 6);
  });

  test('a sell for more than owned is reported as failed, not an HTTP error', async ({ request }) => {
    const res = await request.post('/api/chat', { data: { message: 'sell 100000 NFLX' } });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as ChatResponse;
    expect(body.trades).toHaveLength(1);
    expect(body.trades[0].status).toBe('failed');
    expect(typeof body.trades[0].error).toBe('string');
  });

  test('"remove PYPL" removes from the watchlist', async ({ request }) => {
    await request.post('/api/watchlist', { data: { ticker: 'PYPL' } });
    const res = await request.post('/api/chat', { data: { message: 'remove PYPL' } });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as ChatResponse;
    expect(body.watchlist_changes[0]).toMatchObject({ ticker: 'PYPL', action: 'remove', status: 'executed' });
    expect((await getWatchlist(request)).map((w) => w.ticker)).not.toContain('PYPL');
  });

  test('message over 4000 characters is rejected with 400', async ({ request }) => {
    const res = await request.post('/api/chat', { data: { message: 'x'.repeat(4001) } });
    expect(res.status()).toBe(400);
    expect(await res.json()).toHaveProperty('detail');
  });

  test('empty / missing message is rejected with 400', async ({ request }) => {
    const r1 = await request.post('/api/chat', { data: { message: '' } });
    expect(r1.status()).toBe(400);
    const r2 = await request.post('/api/chat', { data: {} });
    expect(r2.status()).toBe(400);
  });

  test('GET /api/chat/history returns stored messages oldest -> newest', async ({ request }) => {
    const marker = `history-check-${Date.now()}`;
    expect((await request.post('/api/chat', { data: { message: marker } })).status()).toBe(200);

    const res = await request.get('/api/chat/history');
    expect(res.status()).toBe(200);
    const hist = (await res.json()) as Array<{ role: string; content: string; actions: unknown; created_at: string }>;
    expect(Array.isArray(hist)).toBe(true);
    expect(hist.length).toBeGreaterThanOrEqual(2);
    for (const m of hist) {
      expect(['user', 'assistant']).toContain(m.role);
      expect(typeof m.content).toBe('string');
      expect(m).toHaveProperty('actions');
      expect(typeof m.created_at).toBe('string');
    }
    // newest pair is our marker message then the assistant reply
    const last = hist[hist.length - 1];
    const prev = hist[hist.length - 2];
    expect(prev.role).toBe('user');
    expect(prev.content).toBe(marker);
    expect(last.role).toBe('assistant');
    for (let i = 1; i < hist.length; i++) {
      expect(Date.parse(hist[i].created_at)).toBeGreaterThanOrEqual(Date.parse(hist[i - 1].created_at));
    }
  });
});
