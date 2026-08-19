from __future__ import annotations

import os
import shutil
import sqlite3
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from backend.config import get_settings

settings = get_settings()


def _running_on_vercel() -> bool:
    return os.getenv("VERCEL") == "1" or Path("/var/task").exists()


def _normalize_database_url(value: str) -> str:
    if value.startswith("postgres://"):
        return "postgresql+psycopg://" + value[len("postgres://"):]
    if value.startswith("postgresql://") and "+psycopg" not in value.split("://", 1)[0]:
        return "postgresql+psycopg://" + value[len("postgresql://"):]
    return value


def _prepare_vercel_state_sqlite(database_url: str) -> str:
    if not _running_on_vercel() or not database_url.startswith("sqlite:///"):
        return database_url

    source_value = database_url[len("sqlite:///"):]
    source = Path(source_value)
    if not source.is_absolute():
        source = (Path.cwd() / source).resolve()

    target = Path("/tmp/hakeem_free_test.db")
    if not target.exists():
        if source.exists():
            shutil.copy2(source, target)
        else:
            target.touch()

        with sqlite3.connect(target) as conn:
            conn.execute("PRAGMA foreign_keys = ON")
            for table in ("chat_messages", "chat_sessions", "user_profiles", "users"):
                try:
                    conn.execute(f"DELETE FROM {table}")
                except sqlite3.OperationalError:
                    pass
            conn.commit()

    return f"sqlite:///{target}"


state_database_url = _normalize_database_url(
    _prepare_vercel_state_sqlite(settings.database_url)
)
knowledge_database_url = _normalize_database_url(settings.knowledge_database_url)

state_connect_args = {"check_same_thread": False} if state_database_url.startswith("sqlite") else {}
knowledge_connect_args = {"check_same_thread": False} if knowledge_database_url.startswith("sqlite") else {}

engine = create_engine(
    state_database_url,
    pool_pre_ping=True,
    connect_args=state_connect_args,
)
knowledge_engine = create_engine(
    knowledge_database_url,
    pool_pre_ping=True,
    connect_args=knowledge_connect_args,
)


class Base(DeclarativeBase):
    pass


class RoutingSession(Session):
    def get_bind(self, mapper=None, *, clause=None, bind=None, **kw):
        if mapper is not None:
            mapped_class = getattr(mapper, "class_", None)
            if mapped_class is not None and mapped_class.__name__ in {"DdiPair", "RagChunk"}:
                return knowledge_engine
        return super().get_bind(mapper=mapper, clause=clause, bind=bind, **kw)


SessionLocal = sessionmaker(
    class_=RoutingSession,
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)
KnowledgeSessionLocal = sessionmaker(
    bind=knowledge_engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


def init_db() -> None:
    from backend.models import ChatMessage, ChatSession, DdiPair, RagChunk, User, UserProfile

    state_tables = [
        User.__table__,
        UserProfile.__table__,
        ChatSession.__table__,
        ChatMessage.__table__,
    ]
    Base.metadata.create_all(bind=engine, tables=state_tables)

    if not _running_on_vercel():
        Base.metadata.create_all(
            bind=knowledge_engine,
            tables=[DdiPair.__table__, RagChunk.__table__],
        )

    if settings.resolved_rag_store == "pgvector":
        with knowledge_engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS rag_vectors (
                        chunk_id TEXT PRIMARY KEY REFERENCES rag_chunks(id) ON DELETE CASCADE,
                        embedding vector NOT NULL
                    )
                    """
                )
            )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
