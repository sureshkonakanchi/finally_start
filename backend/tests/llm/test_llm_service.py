"""Orchestrator and /api/chat endpoint tests (real temp DB + portfolio service, mocked LLM)."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import db
from app.api.chat import router
from app.llm import client, service
from app.llm.schemas import ChatResponse, TradeInstruction, WatchlistChange


def _respond_with(monkeypatch, response: ChatResponse, captured: list | None = None):
    async def fake(messages):
        if captured is not None:
            captured.append(messages)
        return response

    monkeypatch.setattr(client, "get_chat_response", fake)


@pytest.mark.usefixtures("temp_db")
class TestHandleChat:
    async def test_partial_trade_failures(self, monkeypatch, price_cache, market_source):
        resp = ChatResponse(
            message="Executing",
            trades=[
                TradeInstruction(ticker="AAPL", side="buy", quantity=2),  # ok: $400
                TradeInstruction(ticker="MSFT", side="buy", quantity=1000),  # insufficient cash
                TradeInstruction(ticker="TSLA", side="sell", quantity=1),  # no shares
                TradeInstruction(ticker="ZZZZ", side="buy", quantity=1),  # no price
            ],
            watchlist_changes=[
                WatchlistChange(ticker="PYPL", action="add"),  # ok
                WatchlistChange(ticker="AAPL", action="add"),  # already present
                WatchlistChange(ticker="QQQQ", action="remove"),  # absent
            ],
        )
        _respond_with(monkeypatch, resp)
        out = await service.handle_chat("do stuff", price_cache, market_source)

        assert out["message"] == "Executing"
        statuses = [(t["ticker"], t["status"]) for t in out["trades"]]
        assert statuses == [("AAPL", "executed"), ("MSFT", "failed"), ("TSLA", "failed"),
                            ("ZZZZ", "failed")]
        assert out["trades"][0]["price"] == 200.0
        assert "error" not in out["trades"][0]
        assert "Insufficient cash" in out["trades"][1]["error"]
        assert "Insufficient shares" in out["trades"][2]["error"]
        assert "No price" in out["trades"][3]["error"]

        wl = [(c["ticker"], c["action"], c["status"]) for c in out["watchlist_changes"]]
        assert wl == [("PYPL", "add", "executed"), ("AAPL", "add", "failed"),
                      ("QQQQ", "remove", "failed")]
        assert market_source.added == ["PYPL"]

        # side effects went through the real portfolio service
        assert db.get_cash() == pytest.approx(9600.0)
        assert db.get_position(ticker="AAPL")["quantity"] == 2
        assert "PYPL" in db.list_watchlist()

        history = db.list_chat_messages()
        assert [m["role"] for m in history] == ["user", "assistant"]
        assert history[0]["content"] == "do stuff" and history[0]["actions"] is None
        assert history[1]["content"] == "Executing"
        assert history[1]["actions"] == {
            "trades": out["trades"], "watchlist_changes": out["watchlist_changes"]
        }

    async def test_prompt_contains_context_and_history(
        self, monkeypatch, price_cache, market_source
    ):
        captured: list = []
        _respond_with(monkeypatch, ChatResponse(message="first"), captured)
        await service.handle_chat("hello", price_cache, market_source)
        await service.handle_chat("again", price_cache, market_source)

        msgs = captured[1]
        assert "FinAlly, an AI trading assistant" in msgs[0]["content"]
        assert "Cash: $10,000.00" in msgs[1]["content"]
        assert "AAPL: $200.00" in msgs[1]["content"]
        assert [m["content"] for m in msgs[2:]] == ["hello", "first", "again"]

    async def test_no_actions_stores_null(self, monkeypatch, price_cache, market_source):
        _respond_with(monkeypatch, ChatResponse(message="just chatting"))
        out = await service.handle_chat("hi", price_cache, market_source)
        assert out == {"message": "just chatting", "trades": [], "watchlist_changes": []}
        assert db.list_chat_messages()[-1]["actions"] is None

    async def test_mock_mode_end_to_end(self, monkeypatch, price_cache, market_source):
        monkeypatch.setenv("LLM_MOCK", "true")
        out = await service.handle_chat("buy", price_cache, market_source)
        assert out["trades"] == [{"ticker": "AAPL", "side": "buy", "quantity": 1.0,
                                  "price": 200.0, "status": "executed"}]
        assert db.get_cash() == pytest.approx(9800.0)


@pytest.fixture
def api(temp_db, price_cache, market_source):
    app = FastAPI()
    app.state.price_cache = price_cache
    app.state.market_source = market_source
    app.include_router(router)
    return TestClient(app)


class TestChatApi:
    def test_post_chat_mock(self, monkeypatch, api, market_source):
        monkeypatch.setenv("LLM_MOCK", "true")
        r = api.post("/api/chat", json={"message": "add PYPL"})
        assert r.status_code == 200
        body = r.json()
        assert set(body) == {"message", "trades", "watchlist_changes"}
        assert body["watchlist_changes"] == [
            {"ticker": "PYPL", "action": "add", "status": "executed"}
        ]
        assert market_source.added == ["PYPL"]

    def test_post_chat_llm_failure_is_200(self, monkeypatch, api):
        def raises(**kwargs):
            raise RuntimeError("boom")

        monkeypatch.setattr(client, "completion", raises)
        r = api.post("/api/chat", json={"message": "hello"})
        assert r.status_code == 200
        assert r.json()["message"] == client.ERROR_MESSAGE

    @pytest.mark.parametrize("msg", ["", "   "])
    def test_empty_message_400(self, api, msg):
        r = api.post("/api/chat", json={"message": msg})
        assert r.status_code == 400
        assert isinstance(r.json()["detail"], str)

    def test_history(self, monkeypatch, api):
        monkeypatch.setenv("LLM_MOCK", "true")
        api.post("/api/chat", json={"message": "hello"})
        api.post("/api/chat", json={"message": "buy 1 AAPL"})
        r = api.get("/api/chat/history")
        assert r.status_code == 200
        hist = r.json()
        assert [m["role"] for m in hist] == ["user", "assistant", "user", "assistant"]
        assert set(hist[0]) == {"role", "content", "actions", "created_at"}
        assert hist[3]["actions"]["trades"][0]["status"] == "executed"
