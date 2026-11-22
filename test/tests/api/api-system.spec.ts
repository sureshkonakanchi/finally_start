import { expect, test } from '@playwright/test';
import { DEFAULT_TICKERS, isFiniteNumber } from '../../helpers/api';

test.describe('API: system, SSE and static serving @api', () => {
  test('GET /api/health returns {status: "ok"}', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('GET /api/stream/prices streams SSE events keyed by ticker', async ({ baseURL }) => {
    // The request fixture buffers whole bodies, so read the infinite stream with fetch + abort.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${baseURL}/api/stream/prices`, {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type') ?? '').toContain('text/event-stream');
      expect(res.body).toBeTruthy();

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const events: Record<string, Record<string, unknown>>[] = [];
      while (events.length < 2) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const data = block
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('\n');
          if (data) events.push(JSON.parse(data));
        }
      }
      controller.abort();

      expect(events.length, 'expected at least two SSE data events').toBeGreaterThanOrEqual(2);
      const evt = events[events.length - 1];
      const tickers = Object.keys(evt);
      expect(tickers.length).toBeGreaterThan(0);
      for (const t of DEFAULT_TICKERS) expect(tickers, `SSE payload contains ${t}`).toContain(t);
      for (const [key, upd] of Object.entries(evt)) {
        expect(upd.ticker).toBe(key);
        expect(isFiniteNumber(upd.price)).toBe(true);
        expect(upd.price as number).toBeGreaterThan(0);
        expect(upd).toHaveProperty('previous_price');
        expect(upd).toHaveProperty('timestamp');
        expect(upd).toHaveProperty('change');
        expect(upd).toHaveProperty('change_percent');
        expect(['up', 'down', 'flat']).toContain(upd.direction);
      }
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  });

  test('GET / serves the frontend HTML', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/html');
    expect(await res.text()).toMatch(/<html/i);
  });

  test('unknown /api/* path returns JSON 404, not the SPA', async ({ request }) => {
    const res = await request.get('/api/does-not-exist');
    expect(res.status()).toBe(404);
    expect(res.headers()['content-type']).toContain('application/json');
    expect(await res.json()).toHaveProperty('detail');
  });

  test('unknown non-API path falls back to index.html (SPA fallback)', async ({ request }) => {
    const res = await request.get('/some/client/route');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/html');
  });
});
