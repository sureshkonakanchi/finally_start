"""Repository functions over the FinAlly SQLite database.

Every function takes ``user_id`` as a keyword argument defaulting to ``"default"``.
Tickers are normalized to upper case. Calls inside ``transaction()`` join that
transaction; calls outside it are committed immediately (autocommit mode).
"""

from __future__ import annotations

import json
from typing import Any

from app.db.connection import (
    DEFAULT_CASH,
    DEFAULT_USER_ID,
    _lock,
    get_connection,
    new_id,
    now_iso,
)


def _norm(ticker: str) -> str:
    return ticker.strip().upper()


# --------------------------------------------------------------------------- users / cash


def get_cash(user_id: str = DEFAULT_USER_ID) -> float:
    """Cash balance for the user. Creates the profile (with $10,000) if it does not exist."""
    with _lock:
        conn = get_connection()
        row = conn.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?", (user_id,)
        ).fetchone()
        if row is None:
            conn.execute(
                "INSERT OR IGNORE INTO users_profile (id, cash_balance, created_at) VALUES (?, ?, ?)",
                (user_id, DEFAULT_CASH, now_iso()),
            )
            return DEFAULT_CASH
        return float(row["cash_balance"])


def set_cash(user_id: str = DEFAULT_USER_ID, amount: float = DEFAULT_CASH) -> None:
    """Set the user's cash balance (creates the profile if missing)."""
    with _lock:
        get_connection().execute(
            "INSERT INTO users_profile (id, cash_balance, created_at) VALUES (?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET cash_balance = excluded.cash_balance",
            (user_id, float(amount), now_iso()),
        )


# --------------------------------------------------------------------------- watchlist


def list_watchlist(user_id: str = DEFAULT_USER_ID) -> list[str]:
    """Watched tickers in insertion order."""
    with _lock:
        rows = get_connection().execute(
            "SELECT ticker FROM watchlist WHERE user_id = ? ORDER BY added_at, rowid",
            (user_id,),
        ).fetchall()
    return [r["ticker"] for r in rows]


def add_watchlist(user_id: str = DEFAULT_USER_ID, ticker: str = "") -> bool:
    """Add a ticker. Returns False if it was already present."""
    with _lock:
        cur = get_connection().execute(
            "INSERT OR IGNORE INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
            (new_id(), user_id, _norm(ticker), now_iso()),
        )
        return cur.rowcount == 1


def remove_watchlist(user_id: str = DEFAULT_USER_ID, ticker: str = "") -> bool:
    """Remove a ticker. Returns False if it was absent."""
    with _lock:
        cur = get_connection().execute(
            "DELETE FROM watchlist WHERE user_id = ? AND ticker = ?", (user_id, _norm(ticker))
        )
        return cur.rowcount > 0


# --------------------------------------------------------------------------- positions


def _position_dict(row: Any) -> dict[str, Any]:
    return {
        "ticker": row["ticker"],
        "quantity": float(row["quantity"]),
        "avg_cost": float(row["avg_cost"]),
        "updated_at": row["updated_at"],
    }


def list_positions(user_id: str = DEFAULT_USER_ID) -> list[dict[str, Any]]:
    """All positions, ordered by ticker: ``[{ticker, quantity, avg_cost, updated_at}]``."""
    with _lock:
        rows = get_connection().execute(
            "SELECT ticker, quantity, avg_cost, updated_at FROM positions "
            "WHERE user_id = ? ORDER BY ticker",
            (user_id,),
        ).fetchall()
    return [_position_dict(r) for r in rows]


def get_position(user_id: str = DEFAULT_USER_ID, ticker: str = "") -> dict[str, Any] | None:
    """A single position dict, or None if not held."""
    with _lock:
        row = get_connection().execute(
            "SELECT ticker, quantity, avg_cost, updated_at FROM positions "
            "WHERE user_id = ? AND ticker = ?",
            (user_id, _norm(ticker)),
        ).fetchone()
    return _position_dict(row) if row else None


def upsert_position(
    user_id: str = DEFAULT_USER_ID, ticker: str = "", quantity: float = 0.0, avg_cost: float = 0.0
) -> None:
    """Insert or replace the position's quantity and avg_cost."""
    with _lock:
        get_connection().execute(
            "INSERT INTO positions (id, user_id, ticker, quantity, avg_cost, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(user_id, ticker) DO UPDATE SET quantity = excluded.quantity, "
            "avg_cost = excluded.avg_cost, updated_at = excluded.updated_at",
            (new_id(), user_id, _norm(ticker), float(quantity), float(avg_cost), now_iso()),
        )


def delete_position(user_id: str = DEFAULT_USER_ID, ticker: str = "") -> bool:
    """Delete a position. Returns False if it did not exist."""
    with _lock:
        cur = get_connection().execute(
            "DELETE FROM positions WHERE user_id = ? AND ticker = ?", (user_id, _norm(ticker))
        )
        return cur.rowcount > 0


# --------------------------------------------------------------------------- trades


def insert_trade(
    user_id: str = DEFAULT_USER_ID,
    ticker: str = "",
    side: str = "buy",
    quantity: float = 0.0,
    price: float = 0.0,
) -> dict[str, Any]:
    """Append a trade. Returns ``{id, ticker, side, quantity, price, executed_at}``."""
    side = side.lower()
    if side not in ("buy", "sell"):
        raise ValueError(f"invalid side: {side!r}")
    trade = {
        "id": new_id(),
        "ticker": _norm(ticker),
        "side": side,
        "quantity": float(quantity),
        "price": float(price),
        "executed_at": now_iso(),
    }
    with _lock:
        get_connection().execute(
            "INSERT INTO trades (id, user_id, ticker, side, quantity, price, executed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (trade["id"], user_id, trade["ticker"], side, trade["quantity"], trade["price"],
             trade["executed_at"]),
        )
    return trade


def list_trades(user_id: str = DEFAULT_USER_ID, limit: int = 100) -> list[dict[str, Any]]:
    """Most recent trades, newest first."""
    with _lock:
        rows = get_connection().execute(
            "SELECT id, ticker, side, quantity, price, executed_at FROM trades "
            "WHERE user_id = ? ORDER BY executed_at DESC, rowid DESC LIMIT ?",
            (user_id, int(limit)),
        ).fetchall()
    return [dict(r) for r in rows]


# --------------------------------------------------------------------------- snapshots


def insert_snapshot(user_id: str = DEFAULT_USER_ID, total_value: float = 0.0) -> dict[str, Any]:
    """Record a portfolio value snapshot. Returns ``{total_value, recorded_at}``."""
    snap = {"total_value": float(total_value), "recorded_at": now_iso()}
    with _lock:
        get_connection().execute(
            "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at) "
            "VALUES (?, ?, ?, ?)",
            (new_id(), user_id, snap["total_value"], snap["recorded_at"]),
        )
    return snap


def list_snapshots(user_id: str = DEFAULT_USER_ID, limit: int = 1000) -> list[dict[str, Any]]:
    """The most recent ``limit`` snapshots, ordered oldest -> newest."""
    with _lock:
        rows = get_connection().execute(
            "SELECT total_value, recorded_at FROM portfolio_snapshots "
            "WHERE user_id = ? ORDER BY recorded_at DESC, rowid DESC LIMIT ?",
            (user_id, int(limit)),
        ).fetchall()
    return [{"total_value": float(r["total_value"]), "recorded_at": r["recorded_at"]}
            for r in reversed(rows)]


# --------------------------------------------------------------------------- chat


def insert_chat_message(
    user_id: str = DEFAULT_USER_ID,
    role: str = "user",
    content: str = "",
    actions: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Store a chat message; ``actions`` is JSON-encoded (None stays NULL).

    Returns ``{id, role, content, actions, created_at}``.
    """
    if role not in ("user", "assistant"):
        raise ValueError(f"invalid role: {role!r}")
    msg = {
        "id": new_id(),
        "role": role,
        "content": content,
        "actions": actions,
        "created_at": now_iso(),
    }
    with _lock:
        get_connection().execute(
            "INSERT INTO chat_messages (id, user_id, role, content, actions, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (msg["id"], user_id, role, content,
             json.dumps(actions) if actions is not None else None, msg["created_at"]),
        )
    return msg


def list_chat_messages(user_id: str = DEFAULT_USER_ID, limit: int = 20) -> list[dict[str, Any]]:
    """The most recent ``limit`` messages, ordered oldest -> newest, with ``actions`` decoded."""
    with _lock:
        rows = get_connection().execute(
            "SELECT id, role, content, actions, created_at FROM chat_messages "
            "WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
            (user_id, int(limit)),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "role": r["role"],
            "content": r["content"],
            "actions": json.loads(r["actions"]) if r["actions"] is not None else None,
            "created_at": r["created_at"],
        }
        for r in reversed(rows)
    ]
