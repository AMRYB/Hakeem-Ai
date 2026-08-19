from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, EmailStr, Field


class AuthRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    needs_onboarding: bool


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    age: int = Field(ge=0, le=120)
    health_notes: str = Field(default="", max_length=4000)


class ProfileOut(BaseModel):
    name: str
    age: int
    health_notes: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=6000)
    session_id: str | None = None


class Citation(BaseModel):
    source_type: str
    source_title: str
    source_locator: str
    section: str | None = None
    snippet: str


class ChatResponse(BaseModel):
    session_id: str
    answer: str
    citations: list[Citation] = Field(default_factory=list)
    route: str


class SessionSummary(BaseModel):
    id: str
    title: str
    updated_at: datetime


class MessageOut(BaseModel):
    id: str
    role: str
    content: str
    citations: list[Citation] = Field(default_factory=list)
    created_at: datetime
