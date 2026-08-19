import os
from pathlib import Path

from fastapi import APIRouter

from backend.config import get_settings

router = APIRouter(prefix="/api", tags=["health"])
settings = get_settings()


@router.get("/health")
def health():
    database_backend = "postgresql" if settings.is_postgres else "sqlite"
    aliases_available = Path(settings.drug_aliases_csv).exists()
    safety_patterns_available = Path(settings.safety_patterns_file).exists()
    vercel_oidc_available = bool(os.getenv("VERCEL_OIDC_TOKEN"))

    production_ready = all(
        (
            settings.app_env.lower() == "production",
            settings.is_postgres,
            settings.resolved_rag_store == "pgvector",
            settings.embedding_provider != "sentence_transformers",
            settings.ollama_base_url != "http://localhost:11434",
            aliases_available,
            safety_patterns_available,
        )
    )

    return {
        "status": "ok",
        "app_env": settings.app_env,
        "database_backend": database_backend,
        "rag_store": settings.resolved_rag_store,
        "embedding_provider": settings.embedding_provider,
        "llm_provider": settings.llm_provider,
        "llm_model": settings.ollama_model,
        "runtime_files": {
            "drug_aliases": aliases_available,
            "safety_patterns": safety_patterns_available,
        },
        "vercel_oidc_available": vercel_oidc_available,
        "production_ready": production_ready,
    }
