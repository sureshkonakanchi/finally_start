"""Portfolio service: trade execution, valuation, and watchlist management.

This is the single home of trading logic. Both the REST API and the LLM chat
flow call these functions.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from app import db
from app.market import MarketDataSource, PriceCache

logger = logging.getLogger(__name__)

DEFAULT_USER_ID = "default"
TICKER_RE = re.compile(r"^[A-Z.]{1,10}$")
_EPS = 1e-9  # tolerance for floating point share/cash comparisons


class TradeError(Exception):
    """Trade failed validation. ``str(err)`` is a human-readable message."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class WatchlistError(Exception):
    """Watchlist operation failed. ``status_code`` maps to the HTTP status to return."""

    status_code = 400

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class InvalidTickerError(WatchlistError):
    status_code = 400


class TickerExistsError(WatchlistError):
    status_code = 409


class TickerNotFoundError(WatchlistError):
    status_code = 404


def normalize_ticker(ticker: str) -> str:
    return (ticker or "").strip().upper()


def is_valid_ticker(ticker: str) -> bool:
    return bool(TICKER_RE.match(ticker))


# --------------------------------------------------------------------------- valuation


def get_portfolio(price_cache: PriceCache, user_id: str = DEFAULT_USER_ID) -> dict[str, Any]:
    """Current portfolio valued at live cache prices (falls back to avg_cost if no price)."""
    cash = db.get_cash(user_id=user_id)
    rows = db.list_positions(user_id=user_id)

    positions: list[dict[str, Any]] = []
    positions_value = 0.0
    total_cost = 0.0
    for row in rows:
        qty = row["quantity"]
        avg_cost = row["avg_cost"]
        live = price_cache.get_price(row["ticker"])
        current = live if live is not None else avg_cost
        market_value = qty * current
        cost_basis = qty * avg_cost
        pnl = market_value - cost_basis
        positions.append(
            {
                "ticker": row["ticker"],
                "quantity": qty,
                "avg_cost": round(avg_cost, 4),
                "current_price": round(current, 4),
                "market_value": round(market_value, 2),
                "unrealized_pnl": round(pnl, 2),
                "unrealized_pnl_percent": round(pnl / cost_basis * 100, 4) if cost_basis else 0.0,
                "weight": 0.0,  # filled below
            }
        )
        positions_value += market_value
        total_cost += cost_basis

    for p in positions:
        p["weight"] = round(p["market_value"] / positions_value, 6) if positions_value else 0.0

    total_value = cash + positions_value
    return {
        "cash_balance": round(cash, 2),
        "total_value": round(total_value, 2),
        "positions_value": round(positions_value, 2),
        "unrealized_pnl": round(positions_value - total_cost, 2),
        "positions": positions,
    }


def record_snapshot(price_cache: PriceCache, user_id: str = DEFAULT_USER_ID) -> dict[str, Any]:
    """Persist the current total portfolio value."""
    total = get_portfolio(price_cache, user_id=user_id)["total_value"]
    return db.insert_snapshot(user_id=user_id, total_value=total)


def get_history(user_id: str = DEFAULT_USER_ID, limit: int = 1000) -> list[dict[str, Any]]:
    """Portfolio value snapshots, oldest -> newest."""
    return db.list_snapshots(user_id=user_id, limit=limit)


# --------------------------------------------------------------------------- trading


def execute_trade(
    ticker: str,
    side: str,
    quantity: float,
    price_cache: PriceCache,
    user_id: str = DEFAULT_USER_ID,
) -> dict[str, Any]:
    """Execute a market order at the current cached price.

    Returns the trade dict ``{id, ticker, side, quantity, price, executed_at}``.
    Raises ``TradeError`` on any validation failure (nothing is written in that case).
    """
    ticker = normalize_ticker(ticker)
    side = (side or "").strip().lower()

    if not is_valid_ticker(ticker):
        raise TradeError(f"Invalid ticker '{ticker}'")
    if side not in ("buy", "sell"):
        raise TradeError(f"Invalid side '{side}': must be 'buy' or 'sell'")
    try:
        quantity = float(quantity)
    except (TypeError, ValueError):
        raise TradeError("Quantity must be a number") from None
    if not quantity > 0 or quantity == float("inf"):
        raise TradeError("Quantity must be greater than 0")

    price = price_cache.get_price(ticker)
    if price is None:
        raise TradeError(f"No price available for {ticker}; add it to the watchlist first")

    with db.transaction():
        cash = db.get_cash(user_id=user_id)
        position = db.get_position(user_id=user_id, ticker=ticker)
        held = position["quantity"] if position else 0.0
        avg_cost = position["avg_cost"] if position else 0.0
        cost = quantity * price

        if side == "buy":
            if cost > cash + _EPS:
                raise TradeError(
                    f"Insufficient cash: need ${cost:,.2f} to buy {quantity:g} {ticker}, "
                    f"have ${cash:,.2f}"
                )
            new_qty = held + quantity
            new_avg = (held * avg_cost + cost) / new_qty
            db.set_cash(user_id=user_id, amount=max(cash - cost, 0.0))
            db.upsert_position(user_id=user_id, ticker=ticker, quantity=new_qty, avg_cost=new_avg)
        else:
            if quantity > held + _EPS:
                raise TradeError(
                    f"Insufficient shares: trying to sell {quantity:g} {ticker}, own {held:g}"
                )
            new_qty = held - quantity
            db.set_cash(user_id=user_id, amount=cash + cost)
            if new_qty <= _EPS:
                db.delete_position(user_id=user_id, ticker=ticker)
            else:
                db.upsert_position(
                    user_id=user_id, ticker=ticker, quantity=new_qty, avg_cost=avg_cost
                )

        trade = db.insert_trade(
            user_id=user_id, ticker=ticker, side=side, quantity=quantity, price=price
        )
        record_snapshot(price_cache, user_id=user_id)

    logger.info("Executed %s %g %s @ %.2f", side, quantity, ticker, price)
    return trade


# --------------------------------------------------------------------------- watchlist


def get_watchlist(price_cache: PriceCache, user_id: str = DEFAULT_USER_ID) -> list[dict[str, Any]]:
    """Watchlist tickers with latest prices (price fields are None if not yet priced)."""
    result = []
    for ticker in db.list_watchlist(user_id=user_id):
        update = price_cache.get(ticker)
        result.append(
            {
                "ticker": ticker,
                "price": update.price if update else None,
                "previous_price": update.previous_price if update else None,
                "change": update.change if update else None,
                "change_percent": update.change_percent if update else None,
                "direction": update.direction if update else None,
            }
        )
    return result


def tracked_tickers(user_id: str = DEFAULT_USER_ID) -> list[str]:
    """Tickers the market source must track: watchlist plus held positions."""
    tickers = list(db.list_watchlist(user_id=user_id))
    for p in db.list_positions(user_id=user_id):
        if p["ticker"] not in tickers:
            tickers.append(p["ticker"])
    return tickers


async def add_to_watchlist(
    ticker: str,
    market_source: MarketDataSource | None,
    price_cache: PriceCache | None = None,
    user_id: str = DEFAULT_USER_ID,
) -> dict[str, Any]:
    """Add a ticker to the watchlist and start tracking it. Returns ``{ticker, price}``.

    Raises InvalidTickerError (400) or TickerExistsError (409).
    """
    ticker = normalize_ticker(ticker)
    if not is_valid_ticker(ticker):
        raise InvalidTickerError(
            f"Invalid ticker '{ticker}': must be 1-10 letters (A-Z or '.')"
        )
    if not db.add_watchlist(user_id=user_id, ticker=ticker):
        raise TickerExistsError(f"{ticker} is already in the watchlist")
    if market_source is not None:
        await market_source.add_ticker(ticker)
    price = price_cache.get_price(ticker) if price_cache is not None else None
    return {"ticker": ticker, "price": price}


async def remove_from_watchlist(
    ticker: str,
    market_source: MarketDataSource | None,
    user_id: str = DEFAULT_USER_ID,
) -> dict[str, Any]:
    """Remove a ticker from the watchlist. Returns ``{ticker}``.

    The market source keeps tracking the ticker if a position is still held (so the
    position keeps a live valuation). Raises TickerNotFoundError (404).
    """
    ticker = normalize_ticker(ticker)
    if not db.remove_watchlist(user_id=user_id, ticker=ticker):
        raise TickerNotFoundError(f"{ticker} is not in the watchlist")
    if market_source is not None and db.get_position(user_id=user_id, ticker=ticker) is None:
        await market_source.remove_ticker(ticker)
    return {"ticker": ticker}
