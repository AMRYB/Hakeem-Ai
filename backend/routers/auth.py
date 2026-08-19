from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.db import get_db
from backend.dependencies import client_key, rate_limiter
from backend.models import User
from backend.schemas import AuthRequest, AuthResponse
from backend.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()


@router.post("/signup", response_model=AuthResponse)
def signup(payload: AuthRequest, request: Request, db: Session = Depends(get_db)):
    rate_limiter.check(client_key(request, "signup"), settings.login_rate_limit_per_minute)
    email = payload.email.casefold().strip()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = User(id=str(uuid.uuid4()), email=email, password_hash=hash_password(payload.password))
    db.add(user)
    db.commit()
    return AuthResponse(access_token=create_access_token(user.id), needs_onboarding=True)


@router.post("/login", response_model=AuthResponse)
def login(payload: AuthRequest, request: Request, db: Session = Depends(get_db)):
    rate_limiter.check(client_key(request, "login"), settings.login_rate_limit_per_minute)
    email = payload.email.casefold().strip()
    user = db.scalar(select(User).where(User.email == email))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    return AuthResponse(access_token=create_access_token(user.id), needs_onboarding=user.profile is None)
