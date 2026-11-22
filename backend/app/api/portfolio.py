"""Portfolio endpoints: valuation, trading, history."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services import portfolio as svc

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


class TradeRequest(BaseModel):
    ticker: str
    quantity: float
    side: Literal["buy", "sell"]


@router.get("")
def get_portfolio(request: Request) -> dict[str, Any]:
    return svc.get_portfolio(request.app.state.price_cache)


@router.post("/trade")
def trade(body: TradeRequest, request: Request) -> dict[str, Any]:
    cache = request.app.state.price_cache
    try:
        executed = svc.execute_trade(body.ticker, body.side, body.quantity, cache)
    except svc.TradeError as e:
        raise HTTPException(status_code=400, detail=e.message) from None
    return {"trade": executed, "portfolio": svc.get_portfolio(cache)}


@router.get("/history")
def history() -> list[dict[str, Any]]:
    return svc.get_history()
