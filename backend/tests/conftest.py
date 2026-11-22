"""Shared pytest fixtures."""

from __future__ import annotations

import pytest

from app.market import MarketDataSource, PriceCache

FIXED_PRICES = {
    "AAPL": 190.0,
    "GOOGL": 175.0,
    "MSFT": 420.0,
    "AMZN": 185.0,
    "TSLA": 250.0,
    "NVDA": 800.0,
    "META": 500.0,
    "JPM": 195.0,
    "V": 280.0,
    "NFLX": 600.0,
}


class StubMarketSource(MarketDataSource):
    """Deterministic market source: writes fixed prices once, never ticks."""

    def __init__(self, cache: PriceCache, default_price: float = 100.0) -> None:
        self.cache = cache
        self.default_price = default_price
        self.tickers: list[str] = []
        self.started = False
        self.stopped = False

    async def start(self, tickers: list[str]) -> None:
        self.started = True
        for t in tickers:
            await self.add_ticker(t)

    async def stop(self) -> None:
        self.stopped = True

    async def add_ticker(self, ticker: str) -> None:
        if ticker not in self.tickers:
            self.tickers.append(ticker)
            self.cache.update(ticker, FIXED_PRICES.get(ticker, self.default_price))

    async def remove_ticker(self, ticker: str) -> None:
        self.tickers = [t for t in self.tickers if t != ticker]
        self.cache.remove(ticker)

    def get_tickers(self) -> list[str]:
        return list(self.tickers)


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    """Point app.db at a fresh temp SQLite file (seeded on init)."""
    from app import db

    path = tmp_path / "test.db"
    monkeypatch.setenv("FINALLY_DB_PATH", str(path))
    db.close_db()
    db.init_db(path)
    yield path
    db.close_db()


@pytest.fixture
def price_cache() -> PriceCache:
    cache = PriceCache()
    for ticker, price in FIXED_PRICES.items():
        cache.update(ticker, price)
    return cache
