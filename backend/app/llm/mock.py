"""Deterministic, keyword-driven mock LLM (LLM_MOCK=true) for E2E tests and offline dev.

Rules (case-insensitive, evaluated on the user message):
- "buy [N] [TICKER]"  -> buy trade (defaults: 1 share of AAPL; the ticker must be written in
                         UPPERCASE, e.g. "buy 5 TSLA", so "buy something" still buys AAPL)
- "sell [N] [TICKER]" -> sell trade (same defaults)
- "add TICKER"        -> watchlist add
- "remove TICKER"     -> watchlist remove
- otherwise           -> fixed friendly message, no actions
"""

from __future__ import annotations

import re

from app.llm.schemas import ChatResponse, TradeInstruction, WatchlistChange

DEFAULT_TICKER = "AAPL"
DEFAULT_MESSAGE = (
    "Hi, I'm FinAlly (mock mode). I can analyze your portfolio, buy or sell shares, "
    "and manage your watchlist. Try 'buy 1 AAPL' or 'add PYPL'."
)
_STOPWORDS = {"A", "AN", "THE", "TO", "SOME", "MORE", "SHARE", "SHARES", "OF", "MY", "IT", "FROM"}

_TRADE_RE = re.compile(
    r"\b(buy|sell)\b(?:\s+(\d+(?:\.\d+)?))?(?:\s+(?:shares?\s+(?:of\s+)?)?([A-Za-z.]{1,10})\b)?",
    re.IGNORECASE,
)
# Watchlist tickers may be any case ("add pypl"); common filler words are ignored.
_WATCH_RE = re.compile(r"\b(add|remove)\b\s+([A-Za-z.]{1,10})\b", re.IGNORECASE)


def _ticker(word: str | None) -> str | None:
    if not word:
        return None
    t = word.upper()
    return None if t in _STOPWORDS else t


def mock_response(user_message: str) -> ChatResponse:
    """Return a deterministic ChatResponse for ``user_message``."""
    trades: list[TradeInstruction] = []
    changes: list[WatchlistChange] = []

    trade = _TRADE_RE.search(user_message)
    if trade:
        side = trade.group(1).lower()
        qty = float(trade.group(2)) if trade.group(2) else 1.0
        word = trade.group(3)
        ticker = (_ticker(word) if word and word.isupper() else None) or DEFAULT_TICKER
        trades.append(TradeInstruction(ticker=ticker, side=side, quantity=qty))

    watch = _WATCH_RE.search(user_message)
    if watch:
        ticker = _ticker(watch.group(2))
        if ticker:
            changes.append(WatchlistChange(ticker=ticker, action=watch.group(1).lower()))

    if not trades and not changes:
        return ChatResponse(message=DEFAULT_MESSAGE)

    parts = [f"{t.side.capitalize()}ing {t.quantity:g} {t.ticker}" for t in trades]
    parts += [
        f"{'Adding' if c.action == 'add' else 'Removing'} {c.ticker} "
        f"{'to' if c.action == 'add' else 'from'} your watchlist"
        for c in changes
    ]
    return ChatResponse(
        message="Mock: " + "; ".join(parts) + ".", trades=trades, watchlist_changes=changes
    )
