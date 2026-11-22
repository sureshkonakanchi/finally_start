"""transaction() context manager."""

import pytest

from app import db


def test_transaction_commits(temp_db):
    with db.transaction():
        db.set_cash(amount=500.0)
        db.upsert_position(ticker="AAPL", quantity=1, avg_cost=100.0)
        db.insert_trade(ticker="AAPL", side="buy", quantity=1, price=100.0)
    db.close_db()
    db.init_db(temp_db)
    assert db.get_cash() == 500.0
    assert db.get_position(ticker="AAPL") is not None
    assert len(db.list_trades()) == 1


def test_transaction_rolls_back_on_error(temp_db):
    with pytest.raises(RuntimeError):
        with db.transaction():
            db.set_cash(amount=1.0)
            db.upsert_position(ticker="AAPL", quantity=5, avg_cost=100.0)
            db.insert_trade(ticker="AAPL", side="buy", quantity=5, price=100.0)
            db.insert_snapshot(total_value=1.0)
            raise RuntimeError("boom")
    assert db.get_cash() == 10000.0
    assert db.get_position(ticker="AAPL") is None
    assert db.list_trades() == []
    assert db.list_snapshots() == []


def test_transaction_rolls_back_on_repo_error(temp_db):
    with pytest.raises(ValueError):
        with db.transaction():
            db.set_cash(amount=1.0)
            db.insert_trade(ticker="AAPL", side="bad", quantity=1, price=1.0)
    assert db.get_cash() == 10000.0


def test_nested_transaction_joins_outer(temp_db):
    with pytest.raises(RuntimeError):
        with db.transaction():
            db.set_cash(amount=1.0)
            with db.transaction():
                db.add_watchlist(ticker="PYPL")
            raise RuntimeError("outer fails")
    assert db.get_cash() == 10000.0
    assert "PYPL" not in db.list_watchlist()


def test_transaction_yields_connection_and_usable_after(temp_db):
    with db.transaction() as conn:
        conn.execute("UPDATE users_profile SET cash_balance = 42 WHERE id = 'default'")
    assert db.get_cash() == 42.0
    db.set_cash(amount=7.0)
    assert db.get_cash() == 7.0
    assert not db.get_connection().in_transaction
