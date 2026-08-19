import os
from pathlib import Path

from fastapi import APIRouter, Request
from sqlalchemy import func, select

from backend.config import get_settings
from backend.db import SessionLocal
from backend.models import DdiPair, RagChunk
from backend.rag.llm import get_llm
from backend.rag.retrieval import ddi_pair_lookup, retrieve

router = APIRouter(prefix="/api", tags=["health"])
settings = get_settings()


@router.get("/health")
def health(request: Request):
    database_backend = "postgresql" if settings.is_postgres else "sqlite"
    aliases_available = Path(settings.drug_aliases_csv).exists()
    safety_patterns_available = Path(settings.safety_patterns_file).exists()
    oidc_from_env = bool(os.getenv("VERCEL_OIDC_TOKEN"))
    oidc_from_request = bool(request.headers.get("x-vercel-oidc-token"))
    vercel_oidc_available = oidc_from_env or oidc_from_request
    free_test_db = Path("/tmp/hakeem_free_test.db").exists()

    using_gateway_free_model = (
        vercel_oidc_available
        and settings.llm_provider == "ollama"
        and settings.ollama_base_url.rstrip("/") == "http://localhost:11434"
    )

    if using_gateway_free_model:
        llm_provider = "vercel_ai_gateway"
        llm_model = "inclusionai/ling-3.0-flash-free"
        llm_remote_ready = True
    elif settings.llm_provider == "openai":
        llm_provider = "openai"
        llm_model = settings.openai_model
        llm_remote_ready = bool(settings.openai_api_key or vercel_oidc_available)
    else:
        llm_provider = settings.llm_provider
        llm_model = settings.ollama_model
        llm_remote_ready = settings.ollama_base_url != "http://localhost:11434"

    production_ready = all(
        (
            settings.app_env.lower() == "production",
            settings.is_postgres,
            settings.resolved_rag_store == "pgvector",
            llm_remote_ready,
            aliases_available,
            safety_patterns_available,
        )
    )

    free_test_ready = all(
        (
            free_test_db,
            llm_remote_ready,
            aliases_available,
            safety_patterns_available,
        )
    )

    return {
        "status": "ok",
        "app_env": settings.app_env,
        "database_backend": database_backend,
        "database_persistence": "ephemeral" if free_test_db else "configured",
        "rag_store": settings.resolved_rag_store,
        "rag_fallback": "sql_lexical" if free_test_db else None,
        "embedding_provider": settings.embedding_provider,
        "llm_provider": llm_provider,
        "llm_model": llm_model,
        "runtime_files": {
            "drug_aliases": aliases_available,
            "safety_patterns": safety_patterns_available,
        },
        "vercel_oidc_available": vercel_oidc_available,
        "free_test_mode": free_test_db,
        "free_test_ready": free_test_ready,
        "production_ready": production_ready,
    }


@router.get("/health/smoke")
def smoke_test():
    with SessionLocal() as db:
        ddi_count = db.scalar(select(func.count()).select_from(DdiPair)) or 0
        rag_count = db.scalar(select(func.count()).select_from(RagChunk)) or 0
        pair = ddi_pair_lookup(db, "Acetylsalicylic acid", "Warfarin")
        rag_hits = retrieve(
            db,
            "What are the side effects of acetaminophen?",
            ["Acetaminophen"],
            "single_drug_info",
        )

    ai_reply = None
    ai_error = None
    try:
        ai_reply = get_llm().generate("Reply with exactly: OK")[:40]
    except Exception as exc:
        ai_error = str(exc)[:1000]

    return {
        "status": "ok" if ai_reply else "partial",
        "database": {
            "ddi_pairs": ddi_count,
            "rag_chunks": rag_count,
            "aspirin_warfarin_pair_found": bool(pair),
        },
        "rag": {
            "acetaminophen_hits": len(rag_hits),
            "first_source": rag_hits[0].source_type if rag_hits else None,
        },
        "ai": {
            "reply": ai_reply,
            "error": ai_error,
            "model": "inclusionai/ling-3.0-flash-free",
        },
    }
