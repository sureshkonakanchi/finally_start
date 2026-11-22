"""Fixtures for app.llm tests: temp DB, seeded price cache, fake market source, no network."""

from __future__ import annotations

import pytest

from app import db
from app.market import PriceCache


class FakeMarketSource:
    def __init__(self) -> None:
        self.added: list[str] = []
        self.removed: list[str] = []

    async def add_ticker(self, ticker: str) -> None:
        self.added.append(ticker)

    async def remove_ticker(self, ticker: str) -> None:
        self.removed.append(ticker)


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    """Fail loudly if anything tries a real LLM call; default to non-mock mode."""

    def _boom(*args, **kwargs):
        raise AssertionError("litellm.completion must be mocked in tests")

    monkeypatch.setattr("app.llm.client.completion", _boom)
    monkeypatch.delenv("LLM_MOCK", raising=False)


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    monkeypatch.setenv("FINALLY_DB_PATH", str(tmp_path / "llm_test.db"))
    db.close_db()
    db.init_db()
    yield
    db.close_db()


@pytest.fixture
def price_cache():
    cache = PriceCache()
    cache.update("AAPL", 200.0)
    cache.update("MSFT", 400.0)
    cache.update("TSLA", 250.0)
    return cache


@pytest.fixture
def market_source():
    return FakeMarketSource()
