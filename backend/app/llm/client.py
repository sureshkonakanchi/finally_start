"""LLM client: LiteLLM -> OpenRouter -> Cerebras (see .claude/skills/cerebras/SKILL.md).

``get_chat_response`` is async-safe (the blocking LiteLLM call runs in a worker thread) and never
raises: API/network/parse failures become a friendly fallback ChatResponse with no actions.
"""

from __future__ import annotations

import asyncio
import logging
import os

from litellm import completion

from app.llm.mock import mock_response
from app.llm.parsing import parse_llm_response
from app.llm.schemas import ChatResponse

logger = logging.getLogger(__name__)

MODEL = "openrouter/openai/gpt-oss-120b"
EXTRA_BODY = {"provider": {"order": ["cerebras"]}}

ERROR_MESSAGE = (
    "Sorry, I couldn't reach the AI service right now. No trades or watchlist changes were made. "
    "Please try again in a moment."
)


def is_mock_enabled() -> bool:
    """True when ``LLM_MOCK`` is set to a truthy value."""
    return os.environ.get("LLM_MOCK", "").strip().lower() in ("1", "true", "yes", "on")


def call_llm(messages: list[dict[str, str]]) -> str | None:
    """Blocking structured-output call per the cerebras skill. Returns raw message content."""
    response = completion(
        model=MODEL,
        messages=messages,
        response_format=ChatResponse,
        reasoning_effort="low",
        extra_body=EXTRA_BODY,
    )
    return response.choices[0].message.content


async def get_chat_response(messages: list[dict[str, str]]) -> ChatResponse:
    """Get a parsed ChatResponse for ``messages`` (mock if LLM_MOCK=true). Never raises."""
    if is_mock_enabled():
        user_msgs = [m["content"] for m in messages if m.get("role") == "user"]
        return mock_response(user_msgs[-1] if user_msgs else "")
    try:
        raw = await asyncio.to_thread(call_llm, messages)
    except Exception:  # noqa: BLE001 - any provider/network error must not 500 the chat
        logger.exception("LLM call failed")
        return ChatResponse(message=ERROR_MESSAGE)
    return parse_llm_response(raw)
