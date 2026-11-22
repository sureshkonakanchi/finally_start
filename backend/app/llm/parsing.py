"""Robust parsing of raw LLM output into a ChatResponse. Never raises."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from pydantic import ValidationError

from app.llm.schemas import ChatResponse, TradeInstruction, WatchlistChange

logger = logging.getLogger(__name__)

FALLBACK_MESSAGE = (
    "Sorry, I had trouble understanding the AI response. No trades or watchlist changes were made. "
    "Please try again."
)

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL | re.IGNORECASE)


def _extract_json_object(text: str) -> Any | None:
    """Try hard to pull a JSON value out of ``text`` (code fences, surrounding prose)."""
    candidates = [text]
    fence = _FENCE_RE.match(text)
    if fence:
        candidates.append(fence.group(1))
    start, end = text.find("{"), text.rfind("}")
    if 0 <= start < end:
        candidates.append(text[start : end + 1])
    for cand in candidates:
        try:
            return json.loads(cand)
        except (json.JSONDecodeError, TypeError):
            continue
    return None


def _salvage(data: dict[str, Any]) -> ChatResponse:
    """Keep whatever parts of a partially-invalid object are valid."""
    message = data.get("message")
    if not isinstance(message, str) or not message.strip():
        message = FALLBACK_MESSAGE
    trades: list[TradeInstruction] = []
    changes: list[WatchlistChange] = []
    raw_trades = data.get("trades")
    for item in raw_trades if isinstance(raw_trades, list) else []:
        try:
            trades.append(TradeInstruction.model_validate(item))
        except ValidationError:
            logger.warning("Dropping invalid trade from LLM output: %r", item)
    raw_changes = data.get("watchlist_changes")
    for item in raw_changes if isinstance(raw_changes, list) else []:
        try:
            changes.append(WatchlistChange.model_validate(item))
        except ValidationError:
            logger.warning("Dropping invalid watchlist change from LLM output: %r", item)
    return ChatResponse(message=message, trades=trades, watchlist_changes=changes)


def parse_llm_response(raw: str | None) -> ChatResponse:
    """Parse raw model content into a ChatResponse.

    - valid JSON matching the schema -> parsed as-is
    - JSON with some invalid parts -> valid parts kept, invalid items dropped
    - plain (non-JSON) text -> used as the message, no actions
    - empty / None / unusable -> fallback message, no actions
    """
    if raw is None or not str(raw).strip():
        return ChatResponse(message=FALLBACK_MESSAGE)
    text = str(raw).strip()
    try:
        return ChatResponse.model_validate_json(text)
    except ValidationError:
        pass
    data = _extract_json_object(text)
    if isinstance(data, dict):
        try:
            return ChatResponse.model_validate(data)
        except ValidationError:
            return _salvage(data)
    if data is None and not text.lstrip().startswith(("{", "[", "```")):
        # The model ignored the format and answered in prose: show the prose.
        return ChatResponse(message=text)
    logger.warning("Unparseable LLM output: %.200r", text)
    return ChatResponse(message=FALLBACK_MESSAGE)
