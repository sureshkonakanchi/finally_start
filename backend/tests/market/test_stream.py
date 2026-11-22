"""Tests for the SSE stream generator and router factory."""

import json

from fastapi import FastAPI

from app.market.cache import PriceCache
from app.market.stream import _generate_events, create_stream_router


class FakeRequest:
    """Minimal stand-in for starlette Request: disconnects after N checks."""

    def __init__(self, checks_before_disconnect: int) -> None:
        self._remaining = checks_before_disconnect
        self.client = None

    async def is_disconnected(self) -> bool:
        self._remaining -= 1
        return self._remaining < 0


async def _collect(cache: PriceCache, checks: int) -> list[str]:
    events = []
    async for chunk in _generate_events(cache, FakeRequest(checks), interval=0.001):
        events.append(chunk)
    return events


async def test_first_event_is_retry_directive():
    cache = PriceCache()
    events = await _collect(cache, 1)
    assert events[0] == "retry: 1000\n\n"


async def test_payload_shape_matches_contract():
    cache = PriceCache()
    cache.update("AAPL", 190.0)
    cache.update("AAPL", 191.0)
    cache.update("MSFT", 420.0)
    events = await _collect(cache, 1)
    data_events = [e for e in events if e.startswith("data: ")]
    assert len(data_events) == 1
    payload = json.loads(data_events[0][len("data: ") :].strip())
    assert set(payload) == {"AAPL", "MSFT"}
    aapl = payload["AAPL"]
    assert set(aapl) == {
        "ticker",
        "price",
        "previous_price",
        "timestamp",
        "change",
        "change_percent",
        "direction",
    }
    assert aapl["price"] == 191.0
    assert aapl["previous_price"] == 190.0
    assert aapl["direction"] == "up"


async def test_no_duplicate_event_when_version_unchanged():
    cache = PriceCache()
    cache.update("AAPL", 190.0)
    events = await _collect(cache, 3)
    assert len([e for e in events if e.startswith("data: ")]) == 1


async def test_empty_cache_sends_no_data():
    events = await _collect(PriceCache(), 2)
    assert events == ["retry: 1000\n\n"]


def test_router_factory_creates_independent_routers():
    r1 = create_stream_router(PriceCache())
    r2 = create_stream_router(PriceCache())
    assert r1 is not r2
    assert len(r1.routes) == 1
    app = FastAPI()
    app.include_router(r1)
    assert any(getattr(r, "path", None) == "/api/stream/prices" for r in app.routes)
