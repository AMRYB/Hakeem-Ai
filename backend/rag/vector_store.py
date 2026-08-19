from __future__ import annotations

import json
from functools import lru_cache
from typing import Iterable

from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.db import SessionLocal
from backend.models import RagChunk
from backend.rag.embeddings import get_embedding_provider
from backend.rag.types import RetrievedChunk

settings = get_settings()


def _from_model(chunk: RagChunk, score: float = 0.0) -> RetrievedChunk:
    metadata = json.loads(chunk.metadata_json or "{}")
    locator = chunk.source_path
    if chunk.page_number:
        locator = f"{locator} — page {chunk.page_number}"
    return RetrievedChunk(
        id=chunk.id,
        text=chunk.text,
        source_type=chunk.source_type,
        source_title=chunk.source_title,
        source_locator=locator,
        section=chunk.section,
        generic_name=chunk.generic_name,
        metadata=metadata,
        dense_score=score,
    )


class BaseVectorStore:
    def upsert(self, chunks: list[RagChunk], embeddings: list[list[float]]) -> None:
        raise NotImplementedError

    def query(self, query: str, top_k: int) -> list[RetrievedChunk]:
        raise NotImplementedError

    def reset(self) -> None:
        raise NotImplementedError


class ChromaVectorStore(BaseVectorStore):
    def __init__(self):
        import chromadb

        self.client = chromadb.PersistentClient(path=settings.chroma_dir)
        self.collection = self.client.get_or_create_collection(
            name="ddi_rag_chunks",
            metadata={"hnsw:space": "cosine"},
        )

    def reset(self) -> None:
        try:
            self.client.delete_collection("ddi_rag_chunks")
        except Exception:
            pass
        self.collection = self.client.get_or_create_collection(
            name="ddi_rag_chunks",
            metadata={"hnsw:space": "cosine"},
        )

    def upsert(self, chunks: list[RagChunk], embeddings: list[list[float]]) -> None:
        if not chunks:
            return
        metadatas = []
        for c in chunks:
            meta = json.loads(c.metadata_json or "{}")
            meta.update(
                {
                    "source_type": c.source_type,
                    "source_title": c.source_title,
                    "source_path": c.source_path,
                    "page_number": c.page_number or 0,
                    "generic_name": c.generic_name or "",
                    "section": c.section,
                }
            )
            metadatas.append({k: v for k, v in meta.items() if isinstance(v, (str, int, float, bool))})
        self.collection.upsert(
            ids=[c.id for c in chunks],
            documents=[c.text for c in chunks],
            metadatas=metadatas,
            embeddings=embeddings,
        )

    def query(self, query: str, top_k: int) -> list[RetrievedChunk]:
        if self.collection.count() == 0:
            return []
        vector = get_embedding_provider().embed([query])[0]
        result = self.collection.query(query_embeddings=[vector], n_results=min(top_k, self.collection.count()))
        ids = (result.get("ids") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]
        if not ids:
            return []
        score_by_id = {cid: max(0.0, 1.0 - float(dist)) for cid, dist in zip(ids, distances)}
        with SessionLocal() as db:
            rows = db.query(RagChunk).filter(RagChunk.id.in_(ids)).all()
        by_id = {row.id: row for row in rows}
        return [_from_model(by_id[cid], score_by_id[cid]) for cid in ids if cid in by_id]


class PgVectorStore(BaseVectorStore):
    @staticmethod
    def _literal(vector: list[float]) -> str:
        return "[" + ",".join(f"{float(x):.10g}" for x in vector) + "]"

    def reset(self) -> None:
        from backend.db import engine
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM rag_vectors"))

    def upsert(self, chunks: list[RagChunk], embeddings: list[list[float]]) -> None:
        from backend.db import engine

        if not chunks:
            return
        with engine.begin() as conn:
            for chunk, embedding in zip(chunks, embeddings):
                conn.execute(
                    text(
                        """
                        INSERT INTO rag_vectors (chunk_id, embedding)
                        VALUES (:chunk_id, CAST(:embedding AS vector))
                        ON CONFLICT (chunk_id) DO UPDATE SET embedding = EXCLUDED.embedding
                        """
                    ),
                    {"chunk_id": chunk.id, "embedding": self._literal(embedding)},
                )

    def query(self, query: str, top_k: int) -> list[RetrievedChunk]:
        vector = get_embedding_provider().embed([query])[0]
        literal = self._literal(vector)
        with SessionLocal() as db:
            rows = db.execute(
                text(
                    """
                    SELECT c.id,
                           1 - (v.embedding <=> CAST(:embedding AS vector)) AS similarity
                    FROM rag_vectors v
                    JOIN rag_chunks c ON c.id = v.chunk_id
                    ORDER BY v.embedding <=> CAST(:embedding AS vector)
                    LIMIT :top_k
                    """
                ),
                {"embedding": literal, "top_k": top_k},
            ).all()
            ids = [row[0] for row in rows]
            scores = {row[0]: float(row[1] or 0.0) for row in rows}
            if not ids:
                return []
            chunks = db.query(RagChunk).filter(RagChunk.id.in_(ids)).all()
        by_id = {c.id: c for c in chunks}
        return [_from_model(by_id[cid], scores[cid]) for cid in ids if cid in by_id]


@lru_cache(maxsize=1)
def get_vector_store() -> BaseVectorStore:
    if settings.resolved_rag_store == "pgvector":
        return PgVectorStore()
    if settings.resolved_rag_store == "chroma":
        return ChromaVectorStore()
    raise RuntimeError(f"Unsupported RAG_STORE={settings.resolved_rag_store}")
