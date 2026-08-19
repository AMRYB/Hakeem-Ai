from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from backend.config import get_settings
from backend.db import init_db
from backend.request_context import reset_vercel_oidc_token, set_vercel_oidc_token
from backend.routers import auth, chat, health, profile

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def capture_vercel_oidc(request: Request, call_next):
    context_token = set_vercel_oidc_token(
        request.headers.get("x-vercel-oidc-token", "")
    )
    try:
        return await call_next(request)
    finally:
        reset_vercel_oidc_token(context_token)


app.include_router(health.router)
app.include_router(auth.router)
app.include_router(profile.router)
app.include_router(chat.router)
