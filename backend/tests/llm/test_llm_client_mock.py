"""LLM client (mocked litellm) and deterministic mock-mode tests."""

import json
from types import SimpleNamespace

from app.llm import client
from app.llm.mock import DEFAULT_MESSAGE, mock_response
from app.llm.parsing import FALLBACK_MESSAGE
from app.llm.schemas import ChatResponse


def _fake_completion(content, calls):
    def fake(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])

    return fake


MESSAGES = [{"role": "system", "content": "sys"}, {"role": "user", "content": "hello"}]


class TestClient:
    async def test_uses_cerebras_skill_parameters(self, monkeypatch):
        calls = []
        payload = {"message": "ok", "trades": [{"ticker": "AAPL", "side": "buy", "quantity": 2}],
                   "watchlist_changes": []}
        monkeypatch.setattr(client, "completion", _fake_completion(json.dumps(payload), calls))
        r = await client.get_chat_response(MESSAGES)
        assert r.message == "ok" and r.trades[0].quantity == 2
        kw = calls[0]
        assert kw["model"] == "openrouter/openai/gpt-oss-120b"
        assert kw["extra_body"] == {"provider": {"order": ["cerebras"]}}
        assert kw["reasoning_effort"] == "low"
        assert kw["response_format"] is ChatResponse
        assert kw["messages"] == MESSAGES

    async def test_malformed_content_falls_back(self, monkeypatch):
        monkeypatch.setattr(client, "completion", _fake_completion('{"message": ', []))
        r = await client.get_chat_response(MESSAGES)
        assert r.message == FALLBACK_MESSAGE and r.trades == []

    async def test_none_content_falls_back(self, monkeypatch):
        monkeypatch.setattr(client, "completion", _fake_completion(None, []))
        r = await client.get_chat_response(MESSAGES)
        assert r.message == FALLBACK_MESSAGE

    async def test_exception_returns_error_message(self, monkeypatch):
        def raises(**kwargs):
            raise RuntimeError("network down")

        monkeypatch.setattr(client, "completion", raises)
        r = await client.get_chat_response(MESSAGES)
        assert r.message == client.ERROR_MESSAGE and r.trades == []

    async def test_mock_mode_skips_litellm(self, monkeypatch):
        monkeypatch.setenv("LLM_MOCK", "true")
        # completion is patched to raise by the autouse fixture: must not be called
        r = await client.get_chat_response([{"role": "user", "content": "buy"}])
        assert r.trades[0].ticker == "AAPL"

    def test_is_mock_enabled(self, monkeypatch):
        for val, expected in [("true", True), ("TRUE", True), ("1", True), ("false", False), ("", False)]:
            monkeypatch.setenv("LLM_MOCK", val)
            assert client.is_mock_enabled() is expected


class TestMock:
    def test_buy_defaults_to_one_aapl(self):
        r = mock_response("please buy something")
        assert [(t.ticker, t.side, t.quantity) for t in r.trades] == [("AAPL", "buy", 1.0)]

    def test_buy_with_quantity_and_ticker(self):
        r = mock_response("Buy 5 TSLA")
        assert [(t.ticker, t.side, t.quantity) for t in r.trades] == [("TSLA", "buy", 5.0)]

    def test_sell_shares_of(self):
        r = mock_response("sell 2 shares of MSFT")
        assert [(t.ticker, t.side, t.quantity) for t in r.trades] == [("MSFT", "sell", 2.0)]

    def test_lowercase_word_after_buy_is_not_a_ticker(self):
        r = mock_response("buy me apple stock")
        assert [(t.ticker, t.quantity) for t in r.trades] == [("AAPL", 1.0)]

    def test_add_watchlist(self):
        r = mock_response("add PYPL to my watchlist")
        assert [(c.ticker, c.action) for c in r.watchlist_changes] == [("PYPL", "add")]
        assert r.trades == []

    def test_remove_watchlist(self):
        r = mock_response("remove nflx")
        assert [(c.ticker, c.action) for c in r.watchlist_changes] == [("NFLX", "remove")]

    def test_no_keywords_friendly_message(self):
        r = mock_response("How is my portfolio doing?")
        assert r.message == DEFAULT_MESSAGE
        assert r.trades == [] and r.watchlist_changes == []

    def test_word_boundaries(self):
        r = mock_response("what is my address and buyer info?")
        assert r.trades == [] and r.watchlist_changes == []

    def test_deterministic(self):
        msgs = ["buy 3 NVDA", "add PYPL", "hello", "sell"]
        assert [mock_response(m) for m in msgs] == [mock_response(m) for m in msgs]
