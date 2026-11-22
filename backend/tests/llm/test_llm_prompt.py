"""Prompt construction tests."""

from app.llm.prompt import SYSTEM_PROMPT, build_messages, build_portfolio_context

PORTFOLIO = {
    "cash_balance": 5000.0,
    "total_value": 10250.5,
    "positions_value": 5250.5,
    "unrealized_pnl": 250.5,
    "positions": [
        {"ticker": "AAPL", "quantity": 25, "avg_cost": 200.0, "current_price": 210.02,
         "market_value": 5250.5, "unrealized_pnl": 250.5, "unrealized_pnl_percent": 5.01,
         "weight": 1.0},
    ],
}
WATCHLIST = [
    {"ticker": "AAPL", "price": 210.02, "change_percent": 0.5},
    {"ticker": "PYPL", "price": None, "change_percent": None},
]


def test_system_prompt_identity_and_format():
    assert "FinAlly, an AI trading assistant" in SYSTEM_PROMPT
    assert "JSON" in SYSTEM_PROMPT
    for key in ("message", "trades", "watchlist_changes"):
        assert key in SYSTEM_PROMPT


def test_context_contains_portfolio_numbers():
    ctx = build_portfolio_context(PORTFOLIO, WATCHLIST)
    assert "$5,000.00" in ctx  # cash
    assert "$10,250.50" in ctx  # total
    assert "AAPL: 25 shares" in ctx
    assert "+5.01%" in ctx
    assert "weight 100.0%" in ctx
    assert "PYPL: price pending" in ctx


def test_context_empty_portfolio():
    ctx = build_portfolio_context(
        {"cash_balance": 10000.0, "total_value": 10000.0, "positions_value": 0.0,
         "unrealized_pnl": 0.0, "positions": []},
        [],
    )
    assert "Positions: none" in ctx and "Watchlist: empty" in ctx


def test_build_messages_order_and_history():
    history = [
        {"role": "user", "content": "buy apple", "actions": None},
        {"role": "assistant", "content": "Bought.", "actions": {
            "trades": [{"ticker": "AAPL", "side": "buy", "quantity": 1, "status": "executed"}],
            "watchlist_changes": [{"ticker": "ZZZ", "action": "add", "status": "failed",
                                   "error": "bad"}]}},
    ]
    msgs = build_messages("what now?", "CTX", history)
    assert [m["role"] for m in msgs] == ["system", "system", "user", "assistant", "user"]
    assert msgs[0]["content"] == SYSTEM_PROMPT
    assert msgs[1]["content"] == "CTX"
    assert "buy 1 AAPL: executed" in msgs[3]["content"]
    assert "watchlist add ZZZ: failed (bad)" in msgs[3]["content"]
    assert msgs[-1] == {"role": "user", "content": "what now?"}
