"""Watchlist endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services import portfolio as svc

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


class AddTickerRequest(BaseModel):
    ticker: str


@router.get("")
def list_watchlist(request: Request) -> list[dict[str, Any]]:
    return svc.get_watchlist(request.app.state.price_cache)


@router.post("", status_code=201)
async def add_ticker(body: AddTickerRequest, request: Request) -> dict[str, Any]:
    state = request.app.state
    try:
        return await svc.add_to_watchlist(body.ticker, state.market_source, state.price_cache)
    except svc.WatchlistError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from None


@router.delete("/{ticker}")
async def remove_ticker(ticker: str, request: Request) -> dict[str, Any]:
    try:
        return await svc.remove_from_watchlist(ticker, request.app.state.market_source)
    except svc.WatchlistError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from None
