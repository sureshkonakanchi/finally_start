"""SQLite connection management, lazy initialization, seeding, and transactions.

A single shared connection is used per process. All access goes through a re-entrant
lock so the connection can be used safely from FastAPI's threadpool and the asyncio loop.
"""

from __future__ import annotations

import os
import sqlite3
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

DEFAULT_USER_ID = "default"
DEFAULT_CASH = 10000.0
DEFAULT_TICKERS: tuple[str, ...] = (
    "AAPL", "GOOGL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "NFLX",
)

SCHEMA_PATH = Path(__file__).with_name("schema.sql")
# backend/app/db/connection.py -> parents[3] is the repository root
REPO_ROOT = Path(__file__).resolve().parents[3]
DB_FILENAME = "finally.db"

_lock = threading.RLock()
_local = threading.local()
_conn: sqlite3.Connection | None = None
_db_path: Path | None = None


def now_iso() -> str:
    """Current UTC time as an ISO-8601 string."""
    return datetime.now(UTC).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def resolve_db_path(path: str | os.PathLike[str] | None = None) -> Path:
    """Resolve the DB file path: explicit arg > FINALLY_DB_PATH > <repo_root>/db/finally.db.

    If the resolved path is an existing directory, ``finally.db`` inside it is used.
    """
    if path is None:
        env = os.environ.get("FINALLY_DB_PATH")
        path = env if env else REPO_ROOT / "db" / DB_FILENAME
    p = Path(path)
    if p.is_dir():
        p = p / DB_FILENAME
    return p


def _open(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _seed(conn: sqlite3.Connection) -> None:
    """Seed the default user and watchlist, only when the user profile does not yet exist."""
    cur = conn.execute(
        "INSERT OR IGNORE INTO users_profile (id, cash_balance, created_at) VALUES (?, ?, ?)",
        (DEFAULT_USER_ID, DEFAULT_CASH, now_iso()),
    )
    if cur.rowcount:
        ts = now_iso()
        conn.executemany(
            "INSERT OR IGNORE INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
            [(new_id(), DEFAULT_USER_ID, t, ts) for t in DEFAULT_TICKERS],
        )


def init_db(path: str | os.PathLike[str] | None = None) -> Path:
    """Open (or switch to) the database at ``path``, create tables and seed if needed.

    Idempotent: calling repeatedly with the same path is cheap and never re-seeds.
    Returns the resolved database path.
    """
    global _conn, _db_path
    target = resolve_db_path(path)
    with _lock:
        if _conn is not None and _db_path == target:
            return target
        if _conn is not None:
            _conn.close()
            _conn = None
        conn = _open(target)
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        conn.execute("BEGIN IMMEDIATE")
        try:
            _seed(conn)
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            conn.close()
            raise
        _conn, _db_path = conn, target
        return target


def close_db() -> None:
    """Close the shared connection (used by tests / shutdown). Next access re-inits lazily."""
    global _conn, _db_path
    with _lock:
        if _conn is not None:
            _conn.close()
        _conn, _db_path = None, None


def get_db_path() -> Path | None:
    """Path of the currently open database, or None if not initialized."""
    return _db_path


def get_connection() -> sqlite3.Connection:
    """Return the shared connection, lazily initializing the database if needed."""
    with _lock:
        if _conn is None:
            init_db()
        assert _conn is not None
        return _conn


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """Atomic block for multi-step writes. Commits on success, rolls back on any exception.

    Holds the process-wide DB lock for its duration. Nested use joins the outer transaction.
    Repository functions called inside participate in the same transaction.
    """
    with _lock:
        conn = get_connection()
        depth = getattr(_local, "depth", 0)
        if depth > 0:
            _local.depth = depth + 1
            try:
                yield conn
            finally:
                _local.depth = depth
            return
        conn.execute("BEGIN IMMEDIATE")
        _local.depth = 1
        try:
            yield conn
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        else:
            conn.execute("COMMIT")
        finally:
            _local.depth = 0
