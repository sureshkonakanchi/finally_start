"""Schema and robust-parsing tests."""

import json

import pytest

from app.llm.parsing import FALLBACK_MESSAGE, parse_llm_response
from app.llm.schemas import ChatResponse


class TestValidVariants:
    def test_message_only(self):
        r = parse_llm_response('{"message": "Hello"}')
        assert r.message == "Hello"
        assert r.trades == [] and r.watchlist_changes == []

    def test_empty_arrays(self):
        r = parse_llm_response('{"message": "Hi", "trades": [], "watchlist_changes": []}')
        assert r.trades == [] and r.watchlist_changes == []

    def test_null_arrays(self):
        r = parse_llm_response('{"message": "Hi", "trades": null, "watchlist_changes": null}')
        assert r.trades == [] and r.watchlist_changes == []

    def test_trades_and_watchlist(self):
        raw = json.dumps(
            {
                "message": "Done",
                "trades": [
                    {"ticker": "aapl", "side": "BUY", "quantity": 10},
                    {"ticker": "MSFT", "side": "sell", "quantity": 0.5},
                ],
                "watchlist_changes": [
                    {"ticker": "pypl", "action": "add"},
                    {"ticker": "NFLX", "action": "Remove"},
                ],
            }
        )
        r = parse_llm_response(raw)
        assert [(t.ticker, t.side, t.quantity) for t in r.trades] == [
            ("AAPL", "buy", 10.0),
            ("MSFT", "sell", 0.5),
        ]
        assert [(c.ticker, c.action) for c in r.watchlist_changes] == [
            ("PYPL", "add"),
            ("NFLX", "remove"),
        ]

    def test_code_fenced_json(self):
        r = parse_llm_response('```json\n{"message": "fenced", "trades": []}\n```')
        assert r.message == "fenced"

    def test_json_with_surrounding_prose(self):
        r = parse_llm_response('Sure! {"message": "inner"} hope that helps')
        assert r.message == "inner"

    def test_extra_fields_ignored(self):
        r = parse_llm_response('{"message": "x", "confidence": 0.9}')
        assert r.message == "x"


class TestMalformed:
    @pytest.mark.parametrize("raw", [None, "", "   ", "\n"])
    def test_empty(self, raw):
        r = parse_llm_response(raw)
        assert r.message == FALLBACK_MESSAGE
        assert r.trades == [] and r.watchlist_changes == []

    def test_plain_text_is_used_as_message(self):
        r = parse_llm_response("Your portfolio looks balanced.")
        assert r.message == "Your portfolio looks balanced."
        assert r.trades == []

    @pytest.mark.parametrize("raw", ['{"message": "trunc', "[1, 2, 3]", "{not json}", "```garbage```"])
    def test_broken_json(self, raw):
        r = parse_llm_response(raw)
        assert r.message == FALLBACK_MESSAGE
        assert r.trades == [] and r.watchlist_changes == []

    def test_invalid_items_dropped_valid_kept(self):
        raw = json.dumps(
            {
                "message": "partial",
                "trades": [
                    {"ticker": "AAPL", "side": "buy", "quantity": 1},
                    {"ticker": "MSFT", "side": "hold", "quantity": 1},
                    {"ticker": "TSLA"},
                    "nonsense",
                ],
                "watchlist_changes": [{"ticker": "PYPL", "action": "watch"}, {"ticker": "V", "action": "add"}],
            }
        )
        r = parse_llm_response(raw)
        assert r.message == "partial"
        assert [t.ticker for t in r.trades] == ["AAPL"]
        assert [c.ticker for c in r.watchlist_changes] == ["V"]

    def test_missing_message_uses_fallback_but_keeps_actions(self):
        r = parse_llm_response('{"trades": [{"ticker": "AAPL", "side": "buy", "quantity": 1}]}')
        assert r.message == FALLBACK_MESSAGE
        assert len(r.trades) == 1

    def test_trades_not_a_list(self):
        r = parse_llm_response('{"message": "m", "trades": "buy AAPL"}')
        assert r.message == "m" and r.trades == []


class TestSchema:
    def test_json_schema_is_strict(self):
        schema = ChatResponse.model_json_schema()
        assert set(schema["required"]) == {"message", "trades", "watchlist_changes"}
        assert schema["additionalProperties"] is False
        for name in ("TradeInstruction", "WatchlistChange"):
            sub = schema["$defs"][name]
            assert sub["additionalProperties"] is False
            assert set(sub["required"]) == set(sub["properties"])
