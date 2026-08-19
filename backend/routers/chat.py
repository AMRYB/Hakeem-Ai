from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.db import get_db
from backend.dependencies import get_current_user, rate_limiter
from backend.models import ChatMessage, ChatSession, MessageFeedback, User
from backend.rag.service import answer_question
from backend.schemas import (
    ChatRequest,
    ChatResponse,
    Citation,
    FeedbackIn,
    FeedbackOut,
    MessageOut,
    SessionSummary,
)

router = APIRouter(prefix="/api/chat", tags=["chat"])
settings = get_settings()


def _owned_session(db: Session, session_id: str, user_id: str) -> ChatSession:
    session = db.scalar(select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user_id))
    if not session:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return session


def _recent_turns(db: Session, session_id: str) -> list[tuple[str, str]]:
    rows = db.scalars(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(desc(ChatMessage.created_at))
        .limit(12)
    ).all()
    rows = list(reversed(rows))
    turns: list[tuple[str, str]] = []
    pending_user: str | None = None
    for row in rows:
        if row.role == "user":
            pending_user = row.content
        elif row.role == "assistant" and pending_user is not None:
            turns.append((pending_user, row.content))
            pending_user = None
    return turns[-6:]


@router.post("", response_model=ChatResponse)
def chat(
    payload: ChatRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rate_limiter.check(f"chat:{user.id}", settings.chat_rate_limit_per_minute)
    if payload.session_id:
        session = _owned_session(db, payload.session_id, user.id)
    else:
        session = ChatSession(id=str(uuid.uuid4()), user_id=user.id, title=payload.message[:80])
        db.add(session)
        db.commit()

    history = _recent_turns(db, session.id)
    user_message = ChatMessage(id=str(uuid.uuid4()), session_id=session.id, role="user", content=payload.message)
    db.add(user_message)
    db.commit()

    result = answer_question(db, payload.message, history, user.profile)
    assistant_message = ChatMessage(
        id=str(uuid.uuid4()),
        session_id=session.id,
        role="assistant",
        content=result.answer,
        citations_json=json.dumps(result.citations),
    )
    session.updated_at = datetime.now(timezone.utc)
    db.add_all([assistant_message, session])
    db.commit()

    return ChatResponse(
        session_id=session.id,
        message_id=assistant_message.id,
        answer=result.answer,
        citations=[Citation(**c) for c in result.citations],
        route=result.route,
    )


@router.get("/sessions", response_model=list[SessionSummary])
def list_sessions(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    sessions = db.scalars(
        select(ChatSession).where(ChatSession.user_id == user.id).order_by(desc(ChatSession.updated_at)).limit(50)
    ).all()
    return [SessionSummary(id=s.id, title=s.title, updated_at=s.updated_at) for s in sessions]


@router.get("/sessions/{session_id}", response_model=list[MessageOut])
def get_session_messages(session_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    session = _owned_session(db, session_id, user.id)
    messages = db.scalars(
        select(ChatMessage).where(ChatMessage.session_id == session.id).order_by(ChatMessage.created_at)
    ).all()
    return [
        MessageOut(
            id=m.id,
            role=m.role,
            content=m.content,
            citations=[Citation(**x) for x in json.loads(m.citations_json or "[]")],
            feedback=m.feedback_record.value if m.feedback_record else None,
            created_at=m.created_at,
        )
        for m in messages
    ]


@router.put("/messages/{message_id}/feedback", response_model=FeedbackOut)
def set_message_feedback(
    message_id: str,
    payload: FeedbackIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    message = db.scalar(
        select(ChatMessage)
        .join(ChatSession, ChatMessage.session_id == ChatSession.id)
        .where(
            ChatMessage.id == message_id,
            ChatMessage.role == "assistant",
            ChatSession.user_id == user.id,
        )
    )
    if not message:
        raise HTTPException(status_code=404, detail="Assistant message not found")

    feedback = db.get(MessageFeedback, message.id)
    if payload.feedback is None:
        if feedback:
            db.delete(feedback)
            db.commit()
        return FeedbackOut(message_id=message.id, feedback=None)

    if feedback:
        feedback.value = payload.feedback
        feedback.updated_at = datetime.now(timezone.utc)
    else:
        feedback = MessageFeedback(
            message_id=message.id,
            user_id=user.id,
            value=payload.feedback,
        )
        db.add(feedback)
    db.commit()
    return FeedbackOut(message_id=message.id, feedback=payload.feedback)
