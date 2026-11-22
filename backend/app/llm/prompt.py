"""System prompt, portfolio context, and message assembly for the chat LLM."""

from __future__ import annotations

from typing import Any

SYSTEM_PROMPT = """You are FinAlly, an AI trading assistant embedded in a simulated trading workstation.
The user trades a simulated portfolio with virtual cash (no real money). Market orders only,
filled instantly at the current price, no fees. Fractional shares are allowed.

Your job:
- Analyze the user's portfolio composition, risk concentration, and P&L using the live data provided.
- Suggest trades with brief, concrete reasoning.
- Execute trades when the user asks for them or agrees to your suggestion, by listing them in "trades".
  Trades execute automatically; never claim a trade happened unless you list it in "trades".
  Only trade tickers that have a current price; respect available cash and shares held.
- Manage the watchlist proactively via "watchlist_changes" (add tickers the user is interested in,
  remove ones they no longer want).
- Be concise and data-driven: cite numbers (prices, weights, P&L) where useful. A few sentences at most.

Always respond with valid JSON matching this schema, and nothing else:
{"message": "<your reply to the user>",
 "trades": [{"ticker": "AAPL", "side": "buy" | "sell", "quantity": <number > 0>}],
 "watchlist_changes": [{"ticker": "PYPL", "action": "add" | "remove"}]}
Use empty arrays when there are no trades or watchlist changes."""


def _fmt_money(v: Any) -> str:
    return f"${v:,.2f}" if isinstance(v, int | float) else "n/a"


def build_portfolio_context(portfolio: dict[str, Any], watchlist: list[dict[str, Any]]) -> str:
    """Render portfolio (GET /api/portfolio shape) and watchlist (GET /api/watchlist shape) as text."""
    lines = [
        "Current portfolio state:",
        f"- Cash: {_fmt_money(portfolio.get('cash_balance'))}",
        f"- Positions value: {_fmt_money(portfolio.get('positions_value'))}",
        f"- Total portfolio value: {_fmt_money(portfolio.get('total_value'))}",
        f"- Total unrealized P&L: {_fmt_money(portfolio.get('unrealized_pnl'))}",
    ]
    positions = portfolio.get("positions") or []
    if positions:
        lines.append("Positions:")
        for p in positions:
            weight = p.get("weight") or 0.0
            pnl_pct = p.get("unrealized_pnl_percent") or 0.0
            lines.append(
                f"- {p.get('ticker')}: {p.get('quantity'):g} shares, avg cost "
                f"{_fmt_money(p.get('avg_cost'))}, price {_fmt_money(p.get('current_price'))}, "
                f"value {_fmt_money(p.get('market_value'))}, P&L "
                f"{_fmt_money(p.get('unrealized_pnl'))} ({pnl_pct:+.2f}%), weight {weight * 100:.1f}%"
            )
    else:
        lines.append("Positions: none")
    if watchlist:
        lines.append("Watchlist (live prices):")
        for w in watchlist:
            price = w.get("price")
            if price is None:
                lines.append(f"- {w.get('ticker')}: price pending")
            else:
                chg = w.get("change_percent") or 0.0
                lines.append(f"- {w.get('ticker')}: {_fmt_money(price)} ({chg:+.2f}%)")
    else:
        lines.append("Watchlist: empty")
    return "\n".join(lines)


def _history_content(msg: dict[str, Any]) -> str:
    """Assistant turns get a short summary of executed actions appended for context."""
    content = msg.get("content") or ""
    actions = msg.get("actions")
    if msg.get("role") != "assistant" or not isinstance(actions, dict):
        return content
    notes = []
    for t in actions.get("trades") or []:
        status = t.get("status", "?")
        detail = f" ({t['error']})" if t.get("error") else ""
        notes.append(f"{t.get('side')} {t.get('quantity')} {t.get('ticker')}: {status}{detail}")
    for w in actions.get("watchlist_changes") or []:
        detail = f" ({w['error']})" if w.get("error") else ""
        notes.append(f"watchlist {w.get('action')} {w.get('ticker')}: {w.get('status')}{detail}")
    return f"{content}\n[Actions: {'; '.join(notes)}]" if notes else content


def build_messages(
    user_message: str,
    portfolio_context: str,
    history: list[dict[str, Any]] | None = None,
) -> list[dict[str, str]]:
    """Assemble the LiteLLM ``messages`` list: system, context, history, new user message."""
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": portfolio_context},
    ]
    for msg in history or []:
        if msg.get("role") in ("user", "assistant"):
            messages.append({"role": msg["role"], "content": _history_content(msg)})
    messages.append({"role": "user", "content": user_message})
    return messages
