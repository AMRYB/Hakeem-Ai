from __future__ import annotations

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from backend.config import get_settings

settings = get_settings()
database_url = settings.database_url
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
