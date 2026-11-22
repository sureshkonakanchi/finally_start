"""FinAlly LLM chat integration (LiteLLM -> OpenRouter -> Cerebras, structured outputs)."""

from app.llm.client import EXTRA_BODY, MODEL, get_chat_response, is_mock_enabled
from app.llm.mock import mock_response
from app.llm.parsing import FALLBACK_MESSAGE, parse_llm_response
from app.llm.prompt import SYSTEM_PROMPT, build_messages, build_portfolio_context
from app.llm.schemas import ChatResponse, TradeInstruction, WatchlistChange
from app.llm.service import handle_chat

__all__ = [
    "EXTRA_BODY",
    "FALLBACK_MESSAGE",
    "MODEL",
    "SYSTEM_PROMPT",
    "ChatResponse",
    "TradeInstruction",
    "WatchlistChange",
    "build_messages",
    "build_portfolio_context",
    "get_chat_response",
    "handle_chat",
    "is_mock_enabled",
    "mock_response",
    "parse_llm_response",
]
