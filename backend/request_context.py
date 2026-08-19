from __future__ import annotations

from contextvars import ContextVar, Token

_vercel_oidc_token: ContextVar[str] = ContextVar("vercel_oidc_token", default="")


def set_vercel_oidc_token(value: str) -> Token[str]:
    return _vercel_oidc_token.set(value or "")


def reset_vercel_oidc_token(token: Token[str]) -> None:
    _vercel_oidc_token.reset(token)


def get_vercel_oidc_token() -> str:
    return _vercel_oidc_token.get()
