from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from cryptography.fernet import Fernet
import jwt
from jwt import InvalidTokenError

from backend.config import get_settings

settings = get_settings()
_password_hasher = PasswordHasher()


def _runtime_secret(purpose: str) -> str:
    if settings.secret_key and settings.secret_key != "change-me":
        source = settings.secret_key
    elif settings.groq_api_key:
        source = settings.groq_api_key
    else:
        source = settings.secret_key or "change-me"
    return hashlib.sha256(f"hakeem:{purpose}:{source}".encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def create_access_token(user_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode({"sub": user_id, "exp": exp}, _runtime_secret("jwt"), algorithm="HS256")


def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, _runtime_secret("jwt"), algorithms=["HS256"])
        return payload.get("sub")
    except InvalidTokenError:
        return None


def _fernet() -> Fernet:
    key = settings.profile_encryption_key.strip()
    if not key:
        digest = hashlib.sha256(_runtime_secret("profile").encode("utf-8")).digest()
        key = base64.urlsafe_b64encode(digest).decode("ascii")
    return Fernet(key.encode("ascii"))


def encrypt_text(value: str) -> str:
    if not value:
        return ""
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_text(value: str) -> str:
    if not value:
        return ""
    return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
