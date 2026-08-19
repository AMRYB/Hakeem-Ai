from fastapi import APIRouter

from backend.config import get_settings

router = APIRouter(prefix="/api", tags=["health"])
settings = get_settings()


@router.get("/health")
def health():
    return {
        "status": "ok",
        "rag_store": settings.resolved_rag_store,
        "llm_provider": settings.llm_provider,
        "llm_model": settings.ollama_model,
    }
