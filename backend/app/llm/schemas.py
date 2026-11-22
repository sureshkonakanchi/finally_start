"""Pydantic schemas for the LLM structured output.

The models are *lenient* when parsing (optional lists default to empty, tickers are upper-cased,
sides are lower-cased) but advertise a *strict* JSON schema (every property required, no extra
properties) so that providers enforcing strict structured outputs accept it.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _all_required(schema: dict[str, Any]) -> None:
    """json_schema_extra hook: mark every property required (strict structured outputs)."""
    props = schema.get("properties")
    if props:
        schema["required"] = list(props)
    schema["additionalProperties"] = False


_STRICT = ConfigDict(json_schema_extra=_all_required, extra="ignore")


class TradeInstruction(BaseModel):
    """A trade the assistant wants to auto-execute."""

    model_config = _STRICT

    ticker: str = Field(description="Stock ticker symbol, e.g. AAPL")
    side: Literal["buy", "sell"] = Field(description="buy or sell")
    quantity: float = Field(description="Number of shares (> 0, fractional allowed)")

    @field_validator("ticker", mode="before")
    @classmethod
    def _norm_ticker(cls, v: Any) -> Any:
        return v.strip().upper() if isinstance(v, str) else v

    @field_validator("side", mode="before")
    @classmethod
    def _norm_side(cls, v: Any) -> Any:
        return v.strip().lower() if isinstance(v, str) else v


class WatchlistChange(BaseModel):
    """A watchlist modification the assistant wants to apply."""

    model_config = _STRICT

    ticker: str = Field(description="Stock ticker symbol, e.g. PYPL")
    action: Literal["add", "remove"] = Field(description="add or remove")

    @field_validator("ticker", mode="before")
    @classmethod
    def _norm_ticker(cls, v: Any) -> Any:
        return v.strip().upper() if isinstance(v, str) else v

    @field_validator("action", mode="before")
    @classmethod
    def _norm_action(cls, v: Any) -> Any:
        return v.strip().lower() if isinstance(v, str) else v


class ChatResponse(BaseModel):
    """Structured response returned by the LLM (and by the mock)."""

    model_config = _STRICT

    message: str = Field(description="Conversational response shown to the user")
    trades: list[TradeInstruction] = Field(
        default_factory=list, description="Trades to auto-execute (empty if none)"
    )
    watchlist_changes: list[WatchlistChange] = Field(
        default_factory=list, description="Watchlist changes to apply (empty if none)"
    )

    @field_validator("trades", "watchlist_changes", mode="before")
    @classmethod
    def _none_to_empty(cls, v: Any) -> Any:
        return [] if v is None else v
