"""Repository function behaviour."""

import sqlite3

import pytest

from app import db

# --- cash ---------------------------------------------------------------------------------


def test_get_set_cash(temp_db):
    db.set_cash("default", 2500.5)
    assert db.get_cash("default") == 2500.5
    db.set_cash(user_id="default", amount=0.0)
    assert db.get_cash(user_id="default") == 0.0


def test_cash_unknown_user_gets_default_profile(temp_db):
    assert db.get_cash(user_id="alice") == 10000.0
    db.set_cash(user_id="alice", amount=5.0)
    assert db.get_cash(user_id="alice") == 5.0
    assert db.get_cash() == 10000.0


# --- watchlist ----------------------------------------------------------------------------


def test_add_watchlist(temp_db):
    assert db.add_watchlist(ticker="PYPL") is True
    assert db.list_watchlist()[-1] == "PYPL"


def test_add_watchlist_duplicate_returns_false(temp_db):
    assert db.add_watchlist(ticker="AAPL") is False
    assert db.add_watchlist(ticker="aapl") is False
    assert db.list_watchlist().count("AAPL") == 1


def test_add_watchlist_normalizes_case(temp_db):
    assert db.add_watchlist(ticker=" pypl ") is True
    assert "PYPL" in db.list_watchlist()


def test_remove_watchlist(temp_db):
    assert db.remove_watchlist(ticker="TSLA") is True
    assert "TSLA" not in db.list_watchlist()
    assert db.remove_watchlist(ticker="TSLA") is False
    assert db.remove_watchlist(ticker="NOPE") is False


def test_watchlist_is_per_user(temp_db):
    assert db.list_watchlist(user_id="bob") == []
    assert db.add_watchlist(user_id="bob", ticker="AAPL") is True
    assert db.list_watchlist(user_id="bob") == ["AAPL"]


# --- positions ----------------------------------------------------------------------------


def test_upsert_and_get_position(temp_db):
    assert db.get_position(ticker="AAPL") is None
    db.upsert_position(ticker="AAPL", quantity=10, avg_cost=190.0)
    pos = db.get_position(ticker="aapl")
    assert pos["ticker"] == "AAPL"
    assert pos["quantity"] == 10.0
    assert pos["avg_cost"] == 190.0
    assert pos["updated_at"]


def test_upsert_updates_existing_row(temp_db):
    db.upsert_position(ticker="AAPL", quantity=10, avg_cost=190.0)
    db.upsert_position(ticker="AAPL", quantity=15.5, avg_cost=195.0)
    positions = db.list_positions()
    assert len(positions) == 1
    assert positions[0]["quantity"] == 15.5
    assert positions[0]["avg_cost"] == 195.0


def test_list_positions_shape_and_order(temp_db):
    db.upsert_position(ticker="MSFT", quantity=1, avg_cost=400.0)
    db.upsert_position(ticker="AAPL", quantity=2.25, avg_cost=190.0)
    positions = db.list_positions()
    assert [p["ticker"] for p in positions] == ["AAPL", "MSFT"]
    assert set(positions[0]) == {"ticker", "quantity", "avg_cost", "updated_at"}


def test_delete_position(temp_db):
    db.upsert_position(ticker="AAPL", quantity=1, avg_cost=1.0)
    assert db.delete_position(ticker="AAPL") is True
    assert db.get_position(ticker="AAPL") is None
    assert db.delete_position(ticker="AAPL") is False


# --- trades -------------------------------------------------------------------------------


def test_insert_trade_returns_dict(temp_db):
    trade = db.insert_trade(ticker="aapl", side="buy", quantity=2.5, price=190.0)
    assert set(trade) == {"id", "ticker", "side", "quantity", "price", "executed_at"}
    assert trade["ticker"] == "AAPL"
    assert trade["side"] == "buy"
    assert trade["quantity"] == 2.5
    assert trade["price"] == 190.0
    assert db.list_trades()[0] == trade


def test_list_trades_newest_first_and_limit(temp_db):
    ids = [
        db.insert_trade(ticker="AAPL", side="buy", quantity=i + 1, price=100.0)["id"]
        for i in range(5)
    ]
    trades = db.list_trades()
    assert [t["id"] for t in trades] == list(reversed(ids))
    assert len(db.list_trades(limit=2)) == 2
    assert db.list_trades(limit=2)[0]["id"] == ids[-1]


def test_insert_trade_invalid_side(temp_db):
    with pytest.raises(ValueError):
        db.insert_trade(ticker="AAPL", side="hold", quantity=1, price=1.0)


# --- snapshots ----------------------------------------------------------------------------


def test_snapshots_oldest_to_newest(temp_db):
    for v in (100.0, 200.0, 300.0):
        db.insert_snapshot(total_value=v)
    snaps = db.list_snapshots()
    assert [s["total_value"] for s in snaps] == [100.0, 200.0, 300.0]
    assert set(snaps[0]) == {"total_value", "recorded_at"}


def test_snapshots_limit_keeps_most_recent(temp_db):
    for v in range(10):
        db.insert_snapshot(total_value=float(v))
    assert [s["total_value"] for s in db.list_snapshots(limit=3)] == [7.0, 8.0, 9.0]


# --- chat ---------------------------------------------------------------------------------


def test_chat_actions_json_round_trip(temp_db):
    actions = {
        "trades": [
            {"ticker": "AAPL", "side": "buy", "quantity": 1, "price": 190.5, "status": "executed"}
        ],
        "watchlist_changes": [{"ticker": "PYPL", "action": "add", "status": "executed"}],
    }
    db.insert_chat_message(role="user", content="buy apple", actions=None)
    db.insert_chat_message(role="assistant", content="Done.", actions=actions)
    msgs = db.list_chat_messages()
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[0]["actions"] is None
    assert msgs[1]["actions"] == actions
    assert msgs[1]["content"] == "Done."
    assert msgs[1]["created_at"]


def test_chat_null_actions_stored_as_sql_null(temp_db):
    db.insert_chat_message(role="user", content="hi")
    raw = db.get_connection().execute("SELECT actions FROM chat_messages").fetchone()
    assert raw["actions"] is None


def test_chat_limit_returns_latest_oldest_first(temp_db):
    for i in range(30):
        db.insert_chat_message(role="user", content=f"m{i}")
    msgs = db.list_chat_messages(limit=5)
    assert [m["content"] for m in msgs] == ["m25", "m26", "m27", "m28", "m29"]
    assert len(db.list_chat_messages()) == 20


def test_chat_invalid_role(temp_db):
    with pytest.raises(ValueError):
        db.insert_chat_message(role="system", content="x")


# --- unique constraints -------------------------------------------------------------------

_POS_SQL = (
    "INSERT INTO positions (id, user_id, ticker, quantity, avg_cost, updated_at) "
    "VALUES (?, ?, 'AAPL', 1, 1, 't')"
)


def test_unique_watchlist_constraint(temp_db):
    conn = db.get_connection()
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO watchlist (id, user_id, ticker, added_at) "
            "VALUES ('x', 'default', 'AAPL', 't')"
        )


def test_unique_positions_constraint(temp_db):
    conn = db.get_connection()
    conn.execute(_POS_SQL, ("p1", "default"))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(_POS_SQL, ("p2", "default"))
    # Same ticker for a different user is fine.
    conn.execute(_POS_SQL, ("p3", "other"))
