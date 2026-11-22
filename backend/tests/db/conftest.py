"""Fixtures for app.db tests: a fresh temp database per test."""

import pytest

from app import db


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    path = tmp_path / "test.db"
    monkeypatch.setenv("FINALLY_DB_PATH", str(path))
    db.close_db()
    db.init_db()
    yield path
    db.close_db()
