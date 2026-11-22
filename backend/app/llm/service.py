"""Chat orchestration: context -> LLM -> auto-execute actions -> persist -> response."""

from __future__ import annotations

import logging
from typing import Any

from app import db
from app.llm import client
from app.llm.prompt import build_messages, build_portfolio_context
from app.llm.schemas import ChatResponse
from app.services import portfolio

logger = logging.getLogger(__name__)

DEFAULT_USER_ID = "default"
HISTORY_LIMIT = 20


def load_context(price_cache: Any, user_id: str = DEFAULT_USER_ID) -> str:
    """Portfolio + watchlist context text for the prompt."""
    return build_portfolio_context(
        portfolio.get_portfolio(price_cache, user_id=user_id),
        portfolio.get_watchlist(price_cache, user_id=user_id),
    )


def load_history(user_id: str = DEFAULT_USER_ID, limit: int = HISTORY_LIMIT) -> list[dict]:
    """Recent chat messages, oldest -> newest."""
    return db.list_chat_messages(user_id=user_id, limit=limit)


def execute_trades(
    response: ChatResponse, price_cache: Any, user_id: str = DEFAULT_USER_ID
) -> list[dict[str, Any]]:
    """Execute each trade independently; a failure never stops the others."""
    results: list[dict[str, Any]] = []
    for t in response.trades:
        item: dict[str, Any] = {"ticker": t.ticker, "side": t.side, "quantity": t.quantity}
        try:
            trade = portfolio.execute_trade(
                t.ticker, t.side, t.quantity, price_cache, user_id=user_id
            )
            item["price"] = trade.get("price")
            item["status"] = "executed"
        except portfolio.TradeError as e:
            item["status"] = "failed"
            item["error"] = e.message
        except Exception as e:  # noqa: BLE001
            logger.exception("Unexpected error executing LLM trade %s", item)
            item["status"] = "failed"
            item["error"] = f"Unexpected error: {e}"
        results.append(item)
    return results


async def apply_watchlist_changes(
    response: ChatResponse,
    market_source: Any,
    price_cache: Any,
    user_id: str = DEFAULT_USER_ID,
) -> list[dict[str, Any]]:
    """Apply each watchlist change independently, recording per-item failures."""
    results: list[dict[str, Any]] = []
    for c in response.watchlist_changes:
        item: dict[str, Any] = {"ticker": c.ticker, "action": c.action}
        try:
            if c.action == "add":
                await portfolio.add_to_watchlist(
                    c.ticker, market_source, price_cache, user_id=user_id
                )
            else:
                await portfolio.remove_from_watchlist(c.ticker, market_source, user_id=user_id)
            item["status"] = "executed"
        except portfolio.WatchlistError as e:
            item["status"] = "failed"
            item["error"] = e.message
        except Exception as e:  # noqa: BLE001
            logger.exception("Unexpected error applying LLM watchlist change %s", item)
            item["status"] = "failed"
            item["error"] = f"Unexpected error: {e}"
        results.append(item)
    return results


async def handle_chat(
    message: str,
    price_cache: Any,
    market_source: Any,
    user_id: str = DEFAULT_USER_ID,
) -> dict[str, Any]:
    """Full chat turn. Returns the POST /api/chat response shape (TEAM.md §3)."""
    context = load_context(price_cache, user_id=user_id)
    history = load_history(user_id=user_id)
    messages = build_messages(message, context, history)

    db.insert_chat_message(user_id=user_id, role="user", content=message, actions=None)

    response = await client.get_chat_response(messages)
    trades = execute_trades(response, price_cache, user_id=user_id)
    changes = await apply_watchlist_changes(response, market_source, price_cache, user_id=user_id)

    actions = {"trades": trades, "watchlist_changes": changes}
    db.insert_chat_message(
        user_id=user_id,
        role="assistant",
        content=response.message,
        actions=actions if (trades or changes) else None,
    )
    return {"message": response.message, **actions}
