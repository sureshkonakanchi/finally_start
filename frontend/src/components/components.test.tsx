import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Header from "./Header";
import Heatmap from "./Heatmap";
import PositionsTable from "./PositionsTable";
import TradeBar from "./TradeBar";
import Watchlist, { WatchlistRow } from "./Watchlist";
import Sparkline from "./Sparkline";
import { FLASH_MS } from "@/hooks/usePriceFlash";
import { samplePortfolio } from "@/test/mocks";
import type { WatchlistItem } from "@/lib/types";

const noop = () => {};

describe("Header", () => {
  it("shows value, cash and connection status", () => {
    render(<Header totalValue={10234.5} cash={10000} unrealizedPnl={234.5} costBasis={1000} status="connected" />);
    expect(screen.getByTestId("header-total-value")).toHaveTextContent("$10,234.50");
    expect(screen.getByTestId("header-cash")).toHaveTextContent("$10,000.00");
    const dot = screen.getByTestId("connection-status");
    expect(dot).toHaveAttribute("data-status", "connected");
    expect(dot.className).toContain("bg-up");
  });

  it.each([
    ["reconnecting", "bg-accent"],
    ["disconnected", "bg-down"],
  ] as const)("colors the dot for %s", (status, cls) => {
    render(<Header totalValue={null} cash={null} unrealizedPnl={null} costBasis={0} status={status} />);
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", status);
    expect(screen.getByTestId("connection-status").className).toContain(cls);
    expect(screen.getByTestId("header-total-value")).toHaveTextContent("—");
  });
});

describe("price flash", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const row = (price: number | null) => (
    <ul>
      <WatchlistRow ticker="AAPL" price={price} changePct={0} history={[]} selected={false} onSelect={noop} onRemove={noop} />
    </ul>
  );

  it("adds flash-up on an uptick and removes it after the fade", () => {
    const { rerender } = render(row(100));
    expect(screen.getByTestId("price-AAPL").className).not.toMatch(/flash-/);
    rerender(row(101));
    expect(screen.getByTestId("price-AAPL")).toHaveClass("flash-up");
    expect(screen.getByTestId("price-AAPL")).toHaveTextContent("101.00");
    act(() => {
      vi.advanceTimersByTime(FLASH_MS + 10);
    });
    expect(screen.getByTestId("price-AAPL").className).not.toMatch(/flash-/);
  });

  it("adds flash-down on a downtick", () => {
    const { rerender } = render(row(100));
    rerender(row(99.5));
    expect(screen.getByTestId("price-AAPL")).toHaveClass("flash-down");
  });

  it("does not flash when the price is unchanged", () => {
    const { rerender } = render(row(100));
    rerender(row(100));
    expect(screen.getByTestId("price-AAPL").className).not.toMatch(/flash-/);
  });
});

describe("Watchlist", () => {
  const items: WatchlistItem[] = [
    { ticker: "AAPL", price: 190, previous_price: 189, change: 1, change_percent: 0.5, direction: "up" },
    { ticker: "MSFT", price: null, previous_price: null, change: null, change_percent: null, direction: null },
  ];

  function setup(overrides: Partial<React.ComponentProps<typeof Watchlist>> = {}) {
    const props = {
      items,
      prices: {},
      history: {},
      baseline: {},
      selected: "AAPL",
      onSelect: vi.fn(),
      onAdd: vi.fn().mockResolvedValue(undefined),
      onRemove: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
    render(<Watchlist {...props} />);
    return props;
  }

  it("renders rows with prices and session change", () => {
    setup({ baseline: { AAPL: 100 }, prices: { AAPL: { ticker: "AAPL", price: 110, previous_price: 109, timestamp: 1, change: 1, change_percent: 0.9, direction: "up" } } });
    expect(screen.getByTestId("watchlist")).toBeInTheDocument();
    expect(screen.getByTestId("price-AAPL")).toHaveTextContent("110.00");
    expect(screen.getByTestId("watchlist-row-AAPL")).toHaveTextContent("+10.00%");
    expect(screen.getByTestId("price-MSFT")).toHaveTextContent("—");
  });

  it("selects a ticker on row click", () => {
    const props = setup();
    fireEvent.click(screen.getByTestId("watchlist-row-MSFT"));
    expect(props.onSelect).toHaveBeenCalledWith("MSFT");
  });

  it("adds an upper-cased ticker and clears the input", async () => {
    const props = setup();
    const input = screen.getByTestId("watchlist-add-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "pypl" } });
    fireEvent.click(screen.getByTestId("watchlist-add-button"));
    await waitFor(() => expect(props.onAdd).toHaveBeenCalledWith("PYPL"));
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("rejects invalid or duplicate tickers without calling the API", async () => {
    const props = setup();
    const input = screen.getByTestId("watchlist-add-input");
    fireEvent.change(input, { target: { value: "AB1" } });
    fireEvent.click(screen.getByTestId("watchlist-add-button"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/letters/);
    fireEvent.change(input, { target: { value: "AAPL" } });
    fireEvent.click(screen.getByTestId("watchlist-add-button"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already/);
    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it("shows the server error when adding fails", async () => {
    setup({ onAdd: vi.fn().mockRejectedValue(new Error("ZZZ is already in the watchlist")) });
    fireEvent.change(screen.getByTestId("watchlist-add-input"), { target: { value: "ZZZ" } });
    fireEvent.click(screen.getByTestId("watchlist-add-button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("ZZZ is already in the watchlist");
  });

  it("removes a ticker without selecting it", async () => {
    const props = setup();
    fireEvent.click(screen.getByTestId("watchlist-remove-MSFT"));
    await waitFor(() => expect(props.onRemove).toHaveBeenCalledWith("MSFT"));
    expect(props.onSelect).not.toHaveBeenCalled();
  });
});

describe("Sparkline", () => {
  it("draws a path once two points exist", () => {
    const { container, rerender } = render(<Sparkline points={[{ time: 1, value: 1 }]} />);
    expect(container.querySelector("path")).toBeNull();
    rerender(<Sparkline points={[{ time: 1, value: 1 }, { time: 2, value: 2 }]} />);
    expect(container.querySelector("path")).not.toBeNull();
  });
});

describe("Positions and heatmap", () => {
  const positions = [
    samplePortfolio.positions[0],
    { ...samplePortfolio.positions[0], ticker: "TSLA", avg_cost: 250, current_price: 200, market_value: 2000, unrealized_pnl: -500, unrealized_pnl_percent: -20, weight: 0.5 },
  ];

  it("renders a row per position", () => {
    render(<PositionsTable positions={positions} />);
    expect(screen.getByTestId("positions-table")).toBeInTheDocument();
    expect(screen.getByTestId("position-row-AAPL")).toHaveTextContent("+$100.00");
    expect(screen.getByTestId("position-row-TSLA")).toHaveTextContent("−$500.00");
  });

  it("shows an empty state with no positions", () => {
    render(<PositionsTable positions={[]} />);
    expect(screen.getByTestId("positions-table")).toHaveTextContent(/No open positions/);
    render(<Heatmap positions={[]} />);
    expect(screen.getByTestId("heatmap")).toHaveTextContent(/No positions yet/);
  });

  it("colors heatmap tiles by profit or loss", () => {
    render(<Heatmap positions={positions} />);
    expect(screen.getByTestId("heatmap-tile-AAPL")).toHaveAttribute("data-pnl", "profit");
    expect(screen.getByTestId("heatmap-tile-TSLA")).toHaveAttribute("data-pnl", "loss");
  });
});

describe("TradeBar", () => {
  it("submits a buy with the typed ticker and quantity", async () => {
    const onTrade = vi.fn().mockResolvedValue({ id: 1, ticker: "AAPL", side: "buy", quantity: 2, price: 190, executed_at: "" });
    render(<TradeBar ticker="AAPL" price={190} onTrade={onTrade} />);
    expect(screen.getByTestId("trade-ticker-input")).toHaveValue("AAPL");
    fireEvent.change(screen.getByTestId("trade-quantity-input"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("trade-buy-button"));
    await waitFor(() => expect(onTrade).toHaveBeenCalledWith("AAPL", 2, "buy"));
    expect(await screen.findByText(/Bought 2 AAPL @ 190.00/)).toBeInTheDocument();
  });

  it("shows the server error inline on a failed sell", async () => {
    const onTrade = vi.fn().mockRejectedValue(new Error("Insufficient shares"));
    render(<TradeBar ticker="AAPL" price={190} onTrade={onTrade} />);
    fireEvent.change(screen.getByTestId("trade-quantity-input"), { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("trade-sell-button"));
    expect(await screen.findByTestId("trade-error")).toHaveTextContent("Insufficient shares");
  });

  it("validates quantity before calling the API", async () => {
    const onTrade = vi.fn();
    render(<TradeBar ticker="AAPL" price={190} onTrade={onTrade} />);
    fireEvent.click(screen.getByTestId("trade-buy-button"));
    expect(await screen.findByTestId("trade-error")).toHaveTextContent(/quantity/);
    expect(onTrade).not.toHaveBeenCalled();
  });
});
