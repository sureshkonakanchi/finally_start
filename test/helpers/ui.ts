import { expect, Locator, Page } from '@playwright/test';
import { parseMoney } from './api';

export const tid = (page: Page, id: string): Locator => page.getByTestId(id);

/** Open the app and wait for the shell + a live SSE connection. */
export async function openApp(page: Page, opts: { waitConnected?: boolean } = {}): Promise<void> {
  await page.goto('/');
  await expect(tid(page, 'watchlist')).toBeVisible({ timeout: 20_000 });
  if (opts.waitConnected ?? true) {
    await expect(tid(page, 'connection-status')).toHaveAttribute('data-status', 'connected', { timeout: 20_000 });
  }
}

export async function readMoney(locator: Locator): Promise<number> {
  return parseMoney(await locator.innerText());
}

/** Polls a money-valued locator until it parses as a number. */
export async function waitForMoney(locator: Locator, timeout = 15_000): Promise<number> {
  let value = NaN;
  await expect
    .poll(
      async () => {
        try {
          value = await readMoney(locator);
        } catch {
          value = NaN;
        }
        return Number.isFinite(value);
      },
      { timeout, message: 'element never showed a numeric value' },
    )
    .toBe(true);
  return value;
}

export async function placeTrade(page: Page, ticker: string, quantity: number, side: 'buy' | 'sell'): Promise<void> {
  await tid(page, 'trade-ticker-input').fill(ticker);
  await tid(page, 'trade-quantity-input').fill(String(quantity));
  await tid(page, side === 'buy' ? 'trade-buy-button' : 'trade-sell-button').click();
}

export async function sendChat(page: Page, message: string): Promise<void> {
  await tid(page, 'chat-input').fill(message);
  await tid(page, 'chat-send-button').click();
}

/** rgb(a) string -> tuple, or null when transparent / unparsable. */
export function parseRgb(css: string): [number, number, number] | null {
  const m = css.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
