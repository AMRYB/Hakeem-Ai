from __future__ import annotations

import os
import shutil
import sqlite3
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from backend.config import get_settings

settings = get_settings()


def _running_on_vercel() -> bool:
    return os.getenv("VERCEL") == "1" or Path("/var/task").exists()


def _prepare_vercel_sqlite(database_url: str) -> str:
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


database_url = _prepare_vercel_sqlite(settings.database_url)
if database_url.startswith("postgres://"):
    database_url = "postgresql+psycopg://" + database_url[len("postgres://"):]
elif database_url.startswith("postgresql://") and "+psycopg" not in database_url.split("://", 1)[0]:
    database_url = "postgresql+psycopg://" + database_url[len("postgresql://"):]

connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
engine = create_engine(database_url, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    from backend import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    if settings.is_postgres:
        with engine.begin() as conn:
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
