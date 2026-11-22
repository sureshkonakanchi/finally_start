import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatPanel from "./ChatPanel";
import { jsonResponse } from "@/test/mocks";

describe("ChatPanel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("loads history including inline actions", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { role: "user", content: "buy apple", actions: null, created_at: "" },
        {
          role: "assistant",
          content: "Done.",
          actions: { trades: [{ ticker: "AAPL", side: "buy", quantity: 1, price: 190, status: "executed" }], watchlist_changes: [] },
          created_at: "",
        },
      ]),
    );
    render(<ChatPanel collapsed={false} onToggle={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId("chat-message")).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledWith("/api/chat/history", expect.anything());
    expect(screen.getByTestId("chat-action")).toHaveTextContent(/Bought\s*1 AAPL @ 190\.00/);
  });

  it("shows a loading indicator, then the reply with trade and watchlist confirmations", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    let resolveChat: (r: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolveChat = r)));
    const onActions = vi.fn();
    render(<ChatPanel collapsed={false} onToggle={() => {}} onActions={onActions} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "buy some apple" } });
    fireEvent.click(screen.getByTestId("chat-send-button"));

    expect(await screen.findByTestId("chat-loading")).toBeInTheDocument();
    expect(screen.getAllByTestId("chat-message")).toHaveLength(1);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/chat",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ message: "buy some apple" }) }),
    );

    resolveChat(
      jsonResponse({
        message: "Bought 1 AAPL.",
        trades: [
          { ticker: "AAPL", side: "buy", quantity: 1, price: 190, status: "executed" },
          { ticker: "TSLA", side: "sell", quantity: 5, status: "failed", error: "Insufficient shares" },
        ],
        watchlist_changes: [{ ticker: "PYPL", action: "add", status: "added" }],
      }),
    );

    await waitFor(() => expect(screen.queryByTestId("chat-loading")).toBeNull());
    expect(screen.getAllByTestId("chat-message")).toHaveLength(2);
    const actions = screen.getAllByTestId("chat-action");
    expect(actions).toHaveLength(3);
    expect(actions[0]).toHaveTextContent("1 AAPL @ 190.00");
    expect(actions[1]).toHaveTextContent("Insufficient shares");
    expect(actions[2]).toHaveTextContent("PYPL");
    expect(onActions).toHaveBeenCalledTimes(1);
  });

  it("shows an error message when the chat request fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "LLM unavailable" }, 502));
    render(<ChatPanel collapsed={false} onToggle={() => {}} />);
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("chat-send-button"));
    expect(await screen.findByText(/LLM unavailable/)).toBeInTheDocument();
  });

  it("collapses to a rail", () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    const onToggle = vi.fn();
    render(<ChatPanel collapsed onToggle={onToggle} />);
    expect(screen.getByTestId("chat-panel")).toHaveAttribute("data-collapsed", "true");
    expect(screen.queryByTestId("chat-input")).toBeNull();
    fireEvent.click(screen.getByLabelText("Open AI assistant"));
    expect(onToggle).toHaveBeenCalled();
  });
});
