from __future__ import annotations

from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from threading import Lock

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.db import get_db
from backend.models import User
from backend.security import decode_access_token

settings = get_settings()
bearer = HTTPBearer(auto_error=False)


class InMemoryRateLimiter:
    def __init__(self):
        self._events: dict[str, deque[datetime]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str, limit: int, window_seconds: int = 60) -> None:
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=window_seconds)
        with self._lock:
            q = self._events[key]
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= limit:
                raise HTTPException(status_code=429, detail="Too many requests. Please try again shortly.")
            q.append(now)


rate_limiter = InMemoryRateLimiter()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    user_id = decode_access_token(credentials.credentials)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def client_key(request: Request, suffix: str) -> str:
    host = request.client.host if request.client else "unknown"
    return f"{suffix}:{host}"
