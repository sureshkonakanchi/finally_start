"""Initialization, path resolution, seeding and idempotency."""

import sqlite3
import threading

from app import db

TABLES = {
    "users_profile",
    "watchlist",
    "positions",
    "trades",
    "portfolio_snapshots",
    "chat_messages",
}


def test_creates_all_tables(temp_db):
    names = {
        r["name"]
        for r in db.get_connection().execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    assert TABLES <= names


def test_db_file_created_at_env_path(temp_db):
    assert temp_db.exists()
    assert db.get_db_path() == temp_db


def test_connection_settings(temp_db):
    conn = db.get_connection()
    assert conn.row_factory is sqlite3.Row
    assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"


def test_seed_defaults(temp_db):
    assert db.get_cash() == 10000.0
    assert db.list_watchlist() == [
        "AAPL", "GOOGL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "NFLX",
    ]
    assert db.list_positions() == []
    assert db.list_trades() == []
    assert db.list_snapshots() == []
    assert db.list_chat_messages() == []


def test_init_idempotent_same_process(temp_db):
    db.init_db()
    db.init_db(temp_db)
    assert len(db.list_watchlist()) == 10


def test_init_idempotent_across_reopen_does_not_reseed(temp_db):
    db.set_cash(amount=123.0)
    db.remove_watchlist(ticker="AAPL")
    db.close_db()
    db.init_db(temp_db)
    assert db.get_cash() == 123.0
    assert "AAPL" not in db.list_watchlist()
    assert len(db.list_watchlist()) == 9


def test_init_with_directory_path(tmp_path):
    try:
        resolved = db.init_db(tmp_path)
        assert resolved == tmp_path / "finally.db"
        assert resolved.exists()
        assert db.get_cash() == 10000.0
    finally:
        db.close_db()


def test_creates_parent_directory(tmp_path):
    target = tmp_path / "nested" / "deeper" / "x.db"
    try:
        db.init_db(target)
        assert target.exists()
    finally:
        db.close_db()


def test_default_path_is_repo_db(monkeypatch):
    monkeypatch.delenv("FINALLY_DB_PATH", raising=False)
    path = db.resolve_db_path()
    assert path.name == "finally.db"
    assert path.parent.name == "db"
    assert (path.parent.parent / "backend").is_dir()


def test_lazy_init_via_get_connection(tmp_path, monkeypatch):
    monkeypatch.setenv("FINALLY_DB_PATH", str(tmp_path / "lazy.db"))
    db.close_db()
    try:
        assert db.get_cash() == 10000.0
        assert (tmp_path / "lazy.db").exists()
    finally:
        db.close_db()


def test_switching_paths(tmp_path):
    try:
        db.init_db(tmp_path / "a.db")
        db.set_cash(amount=1.0)
        db.init_db(tmp_path / "b.db")
        assert db.get_cash() == 10000.0
        db.init_db(tmp_path / "a.db")
        assert db.get_cash() == 1.0
    finally:
        db.close_db()


def test_concurrent_writes_from_threads(temp_db):
    def worker(i):
        for j in range(20):
            db.insert_snapshot(total_value=float(i * 100 + j))

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(db.list_snapshots()) == 100
