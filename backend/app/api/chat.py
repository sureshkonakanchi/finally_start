"""Chat endpoints: POST /api/chat and GET /api/chat/history."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app import db
from app.llm.service import handle_chat

router = APIRouter(tags=["chat"])

MAX_MESSAGE_LENGTH = 4000
HISTORY_LIMIT = 100


class ChatRequest(BaseModel):
    message: str


@router.post("/api/chat")
async def chat(body: ChatRequest, request: Request) -> dict[str, Any]:
    message = (body.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message must not be empty")
    if len(message) > MAX_MESSAGE_LENGTH:
        raise HTTPException(
            status_code=400, detail=f"Message too long (max {MAX_MESSAGE_LENGTH} characters)"
        )
    state = request.app.state
    return await handle_chat(message, state.price_cache, getattr(state, "market_source", None))


@router.get("/api/chat/history")
def chat_history() -> list[dict[str, Any]]:
    return [
        {
            "role": m["role"],
            "content": m["content"],
            "actions": m["actions"],
            "created_at": m["created_at"],
        }
        for m in db.list_chat_messages(limit=HISTORY_LIMIT)
    ]
