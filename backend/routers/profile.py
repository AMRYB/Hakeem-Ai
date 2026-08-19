from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.dependencies import get_current_user
from backend.models import User, UserProfile
from backend.schemas import ProfileIn, ProfileOut
from backend.security import decrypt_text, encrypt_text

router = APIRouter(prefix="/api/profile", tags=["profile"])


@router.get("", response_model=ProfileOut | None)
def get_profile(user: User = Depends(get_current_user)):
    if not user.profile:
        return None
    return ProfileOut(
        name=decrypt_text(user.profile.encrypted_name),
        age=int(decrypt_text(user.profile.encrypted_age)),
        health_notes=decrypt_text(user.profile.encrypted_health_notes),
    )


@router.put("", response_model=ProfileOut)
def upsert_profile(payload: ProfileIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    profile = user.profile or UserProfile(user_id=user.id)
    profile.encrypted_name = encrypt_text(payload.name)
    profile.encrypted_age = encrypt_text(str(payload.age))
    profile.encrypted_health_notes = encrypt_text(payload.health_notes)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return ProfileOut(name=payload.name, age=payload.age, health_notes=payload.health_notes)
