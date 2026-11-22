import { expect, test } from '@playwright/test';
import { ensureInWatchlist, getHistory, getPortfolio, quantityOf, trade, waitForPrice } from '../../helpers/api';
import { openApp, parseRgb, tid } from '../../helpers/ui';

test.describe('Portfolio visualizations', () => {
  test.beforeAll(async ({ request }) => {
    // Guarantee at least two positions so the heatmap has cells.
    for (const t of ['GOOGL', 'AMZN']) {
      await ensureInWatchlist(request, t);
      await waitForPrice(request, t);
      if (quantityOf(await getPortfolio(request), t) === 0) await trade(request, t, 'buy', 1);
    }
  });

  test('heatmap renders a cell per position, colored by P&L', async ({ page, request }) => {
    await openApp(page);
    // let prices drift away from cost so P&L is non-zero
    await page.waitForTimeout(3000);
    const heatmap = tid(page, 'heatmap');
    await expect(heatmap).toBeVisible();

    const box = await heatmap.boundingBox();
    expect(box && box.width > 50 && box.height > 50, 'heatmap has a real size').toBeTruthy();

    const positions = (await getPortfolio(request)).positions;
    for (const pos of positions) {
      await expect(heatmap, `heatmap mentions ${pos.ticker}`).toContainText(pos.ticker);
    }

    // At least one element inside the heatmap is green- or red-tinted (fill or background).
    const colors: string[] = await heatmap.evaluate((root) => {
      const out: string[] = [];
      const els = [root, ...Array.from(root.querySelectorAll('*'))];
      for (const el of els) {
        const cs = getComputedStyle(el as Element);
        out.push(cs.backgroundColor, cs.fill);
        const attrFill = (el as Element).getAttribute('fill');
        if (attrFill) out.push(attrFill);
      }
      return out;
    });
    const tinted = colors
      .map((c) => parseRgb(c) ?? hexToRgb(c))
      .filter((c): c is [number, number, number] => !!c)
      .filter(([r, g]) => Math.abs(r - g) > 30);
    expect(tinted.length, `expected red/green-tinted cells; saw ${[...new Set(colors)].slice(0, 15).join(' | ')}`).toBeGreaterThan(0);
  });

  test('P&L chart renders with data points', async ({ page, request }) => {
    const hist = await getHistory(request);
    expect(hist.length, 'history has snapshots after trades').toBeGreaterThan(0);

    await openApp(page);
    const chart = tid(page, 'pnl-chart');
    await expect(chart).toBeVisible();
    // Canvas (Lightweight Charts) or SVG (Recharts) with drawn content
    const drawn = chart.locator('canvas, svg path, svg polyline, svg circle');
    await expect.poll(() => drawn.count(), { message: 'P&L chart has no canvas/svg content' }).toBeGreaterThan(0);
  });

  test('positions table shows required columns for each position', async ({ page, request }) => {
    await openApp(page);
    const p = await getPortfolio(request);
    expect(p.positions.length).toBeGreaterThan(0);
    for (const pos of p.positions) {
      const row = tid(page, `position-row-${pos.ticker}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(pos.ticker);
    }
    const table = tid(page, 'positions-table');
    for (const header of [/qty|quantity/i, /avg/i, /p&l|pnl/i]) {
      await expect(table).toContainText(header);
    }
  });
});

function hexToRgb(c: string): [number, number, number] | null {
  const m = c.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
