"""FinAlly FastAPI application entry point.

Run (from backend/): uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.config import SNAPSHOT_INTERVAL_SECONDS, get_static_dir, load_env

load_env()  # before importing modules that may read env at import time

from app import db  # noqa: E402
from app.api import health, portfolio, watchlist  # noqa: E402
from app.market import PriceCache, create_market_data_source, create_stream_router  # noqa: E402
from app.services import portfolio as portfolio_service  # noqa: E402
from app.static import mount_static  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


async def _snapshot_loop(cache: PriceCache, interval: float) -> None:
    while True:
        await asyncio.sleep(interval)
        try:
            portfolio_service.record_snapshot(cache)
        except Exception:
            logger.exception("Portfolio snapshot failed")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    db.init_db()
    cache = app.state.price_cache
    source = create_market_data_source(cache)
    await source.start(portfolio_service.tracked_tickers())
    app.state.market_source = source
    portfolio_service.record_snapshot(cache)  # initial point for the P&L chart
    snapshot_task = asyncio.create_task(
        _snapshot_loop(cache, SNAPSHOT_INTERVAL_SECONDS), name="portfolio-snapshots"
    )
    logger.info("FinAlly started: tracking %d tickers", len(source.get_tickers()))
    try:
        yield
    finally:
        snapshot_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await snapshot_task
        await source.stop()
        db.close_db()


def _include_chat_router(app: FastAPI) -> None:
    try:
        from app.api.chat import router as chat_router
    except ImportError as e:
        logger.warning("Chat router unavailable (app.api.chat not importable: %s); "
                       "/api/chat will not be served", e)
        return
    app.include_router(chat_router)


def create_app() -> FastAPI:
    app = FastAPI(title="FinAlly", lifespan=lifespan)
    app.state.price_cache = PriceCache()
    app.state.market_source = None

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        parts = []
        for err in exc.errors():
            loc = ".".join(str(x) for x in err.get("loc", ()) if x != "body")
            parts.append(f"{loc}: {err.get('msg')}" if loc else str(err.get("msg")))
        return JSONResponse({"detail": "; ".join(parts) or "Invalid request"}, status_code=400)

    app.include_router(health.router)
    app.include_router(create_stream_router(app.state.price_cache))
    app.include_router(portfolio.router)
    app.include_router(watchlist.router)
    _include_chat_router(app)
    mount_static(app, get_static_dir())  # last: /api/* always wins
    return app


app = create_app()
