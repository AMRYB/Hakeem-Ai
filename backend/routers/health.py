from pathlib import Path

from fastapi import APIRouter
from sqlalchemy import func, select

from backend.config import get_settings
from backend.db import SessionLocal
from backend.models import DdiPair, RagChunk
from backend.rag.llm import get_llm
from backend.rag.retrieval import ddi_pair_lookup, retrieve

router = APIRouter(prefix="/api", tags=["health"])
settings = get_settings()


@router.get("/health")
def health():
    database_backend = "postgresql" if settings.is_postgres else "sqlite"
    aliases_available = Path(settings.drug_aliases_csv).exists()
    safety_patterns_available = Path(settings.safety_patterns_file).exists()
    free_test_db = Path("/tmp/hakeem_free_test.db").exists()

    if settings.groq_api_key:
        llm_provider = "groq"
        llm_model = settings.groq_model
        llm_remote_ready = True
    elif settings.llm_provider == "openai":
        llm_provider = "openai"
        llm_model = settings.openai_model
        llm_remote_ready = bool(settings.openai_api_key)
    elif settings.llm_provider == "groq":
        llm_provider = "groq"
        llm_model = settings.groq_model
        llm_remote_ready = bool(settings.groq_api_key)
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
        "free_test_mode": free_test_db,
        "free_test_ready": free_test_ready,
        "missing_for_free_test": [] if free_test_ready else (["GROQ_API_KEY"] if not settings.groq_api_key else []),
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
            "What are the adverse reactions of Amikacin?",
            ["Amikacin"],
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
            "amikacin_hits": len(rag_hits),
            "first_source": rag_hits[0].source_type if rag_hits else None,
        },
        "ai": {
            "reply": ai_reply,
            "error": ai_error,
            "provider": "groq" if settings.groq_api_key else "not_configured",
            "model": settings.groq_model,
        },
    }
