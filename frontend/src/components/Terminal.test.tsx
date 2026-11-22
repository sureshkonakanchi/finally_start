import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Terminal from "./Terminal";
import { MockEventSource, installEventSource, jsonResponse, samplePortfolio, tick } from "@/test/mocks";

const TESTIDS = [
  "header-total-value",
  "header-cash",
  "connection-status",
  "watchlist",
  "watchlist-add-input",
  "watchlist-add-button",
  "main-chart",
  "heatmap",
  "pnl-chart",
  "positions-table",
  "trade-ticker-input",
  "trade-quantity-input",
  "trade-buy-button",
  "trade-sell-button",
  "chat-panel",
  "chat-input",
  "chat-send-button",
];

function routeFetch(overrides: Record<string, () => Response> = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    if (overrides[key]) return overrides[key]();
    switch (key) {
      case "GET /api/watchlist":
        return jsonResponse([
          { ticker: "AAPL", price: 190, previous_price: 189, change: 1, change_percent: 0.5, direction: "up" },
          { ticker: "GOOGL", price: 175, previous_price: 175, change: 0, change_percent: 0, direction: "flat" },
        ]);
      case "GET /api/portfolio":
        return jsonResponse(samplePortfolio);
      case "GET /api/portfolio/history":
        return jsonResponse([{ total_value: 10000, recorded_at: "2023-11-14T22:13:20Z" }]);
      case "GET /api/chat/history":
        return jsonResponse([]);
      default:
        return jsonResponse({ detail: `unexpected ${key}` }, 500);
    }
  });
}

describe("Terminal", () => {
  let fetchMock: ReturnType<typeof routeFetch>;

  beforeEach(() => {
    installEventSource();
    fetchMock = routeFetch();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders every contract test id", async () => {
    render(<Terminal />);
    await screen.findByTestId("watchlist-row-AAPL");
    for (const id of TESTIDS) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getByTestId("price-AAPL")).toBeInTheDocument();
    expect(screen.getByTestId("watchlist-remove-AAPL")).toBeInTheDocument();
    expect(await screen.findByTestId("position-row-AAPL")).toBeInTheDocument();
  });

  it("tracks connection state and updates the header total from streamed prices", async () => {
    render(<Terminal />);
    await waitFor(() => expect(screen.getByTestId("header-total-value")).toHaveTextContent("$6,900.00"));
    expect(screen.getByTestId("header-cash")).toHaveTextContent("$5,000.00");
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", "reconnecting");

    const es = MockEventSource.latest();
    expect(es.url).toBe("/api/stream/prices");
    act(() => es.open());
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

    act(() => es.emit(tick("AAPL", 200, 190)));
    expect(screen.getByTestId("price-AAPL")).toHaveTextContent("200.00");
    expect(screen.getByTestId("header-total-value")).toHaveTextContent("$7,000.00");

    act(() => es.fail(false));
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", "reconnecting");
    act(() => es.fail(true));
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", "disconnected");
  });

  it("does not add stream-only tickers to the watchlist", async () => {
    render(<Terminal />);
    await screen.findByTestId("watchlist-row-AAPL");
    act(() => MockEventSource.latest().emit(tick("NFLX", 600, 599)));
    expect(screen.queryByTestId("watchlist-row-NFLX")).toBeNull();
  });

  it("executes a trade and refreshes the portfolio", async () => {
    const after = { ...samplePortfolio, cash_balance: 4620, positions: [{ ...samplePortfolio.positions[0], quantity: 12 }] };
    fetchMock = routeFetch({
      "POST /api/portfolio/trade": () =>
        jsonResponse({ trade: { id: "t1", ticker: "AAPL", side: "buy", quantity: 2, price: 190, executed_at: "" }, portfolio: after }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<Terminal />);
    await screen.findByTestId("position-row-AAPL");
    await waitFor(() => expect(screen.getByTestId("trade-ticker-input")).toHaveValue("AAPL"));
    fireEvent.change(screen.getByTestId("trade-quantity-input"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("trade-buy-button"));
    await waitFor(() => expect(screen.getByTestId("header-cash")).toHaveTextContent("$4,620.00"));
    expect(screen.getByTestId("position-row-AAPL")).toHaveTextContent("12");
    const call = fetchMock.mock.calls.find(([u, i]) => u === "/api/portfolio/trade" && i?.method === "POST");
    expect(JSON.parse(call![1]!.body as string)).toEqual({ ticker: "AAPL", quantity: 2, side: "buy" });
  });

  it("shows the API detail when a trade is rejected", async () => {
    fetchMock = routeFetch({
      "POST /api/portfolio/trade": () => jsonResponse({ detail: "No price available for ZZZ; add it to the watchlist first" }, 400),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<Terminal />);
    await screen.findByTestId("watchlist-row-AAPL");
    fireEvent.change(screen.getByTestId("trade-ticker-input"), { target: { value: "ZZZ" } });
    fireEvent.change(screen.getByTestId("trade-quantity-input"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("trade-buy-button"));
    expect(await screen.findByTestId("trade-error")).toHaveTextContent("No price available for ZZZ");
  });

  it("adds and removes watchlist tickers through the API", async () => {
    let list = [{ ticker: "AAPL", price: 190, previous_price: 189, change: 1, change_percent: 0.5, direction: "up" }];
    fetchMock = routeFetch({
      "GET /api/watchlist": () => jsonResponse(list),
      "POST /api/watchlist": () => {
        list = [...list, { ticker: "PYPL", price: 60, previous_price: 60, change: 0, change_percent: 0, direction: "flat" }];
        return jsonResponse({ ticker: "PYPL", price: 60 }, 201);
      },
      "DELETE /api/watchlist/AAPL": () => {
        list = list.filter((i) => i.ticker !== "AAPL");
        return jsonResponse({ ticker: "AAPL" });
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<Terminal />);
    await screen.findByTestId("watchlist-row-AAPL");

    fireEvent.change(screen.getByTestId("watchlist-add-input"), { target: { value: "pypl" } });
    fireEvent.click(screen.getByTestId("watchlist-add-button"));
    expect(await screen.findByTestId("watchlist-row-PYPL")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("watchlist-remove-AAPL"));
    await waitFor(() => expect(screen.queryByTestId("watchlist-row-AAPL")).toBeNull());
  });
});
