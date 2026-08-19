from pathlib import Path

from fastapi import APIRouter

from backend.config import get_settings

router = APIRouter(prefix="/api", tags=["health"])
settings = get_settings()


@router.get("/health")
def health():
    aliases_available = Path(settings.drug_aliases_csv).exists()
    safety_patterns_available = Path(settings.safety_patterns_file).exists()
    ephemeral_state_db = Path("/tmp/hakeem_free_test.db").exists() and not settings.is_postgres

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

    state_persistent = settings.is_postgres
    knowledge_local = not settings.is_knowledge_postgres

    free_test_ready = all(
        (
            state_persistent or ephemeral_state_db,
            knowledge_local,
            llm_remote_ready,
            aliases_available,
            safety_patterns_available,
        )
    )

    production_ready = all(
        (
            settings.app_env.lower() == "production",
            state_persistent,
            llm_remote_ready,
            aliases_available,
            safety_patterns_available,
        )
    )

    return {
        "status": "ok",
        "app_env": settings.app_env,
        "state_database": {
            "backend": "postgresql" if settings.is_postgres else "sqlite",
            "persistence": "persistent" if state_persistent else "ephemeral",
        },
        "knowledge_database": {
            "backend": "postgresql" if settings.is_knowledge_postgres else "sqlite",
            "persistence": "bundled_read_only" if knowledge_local else "persistent",
        },
        "rag_store": settings.resolved_rag_store,
        "rag_fallback": "sql_lexical" if knowledge_local else None,
        "llm_provider": llm_provider,
        "llm_model": llm_model,
        "runtime_files": {
            "drug_aliases": aliases_available,
            "safety_patterns": safety_patterns_available,
        },
        "free_test_ready": free_test_ready,
        "production_ready": production_ready,
    }

# Deployment refresh marker after Supabase integration.
