from datetime import datetime, timezone
import json
from pathlib import Path
import uuid

from fastapi import APIRouter
from sqlalchemy import delete, func, select

from backend.config import get_settings
from backend.db import SessionLocal
from backend.models import ChatMessage, ChatSession, DdiPair, RagChunk, User, UserProfile
from backend.rag.llm import get_llm
from backend.rag.retrieval import ddi_pair_lookup, retrieve
from backend.rag.service import answer_question
from backend.security import (
    create_access_token,
    decode_access_token,
    decrypt_text,
    encrypt_text,
    hash_password,
    verify_password,
)

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


# Temporary smoke endpoint; it is removed after end-to-end verification.
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


# Temporary end-to-end endpoint; it creates and removes an isolated synthetic user.
@router.get("/health/e2e")
def e2e_test():
    marker = uuid.uuid4().hex
    user_id = str(uuid.uuid4())
    session_id = str(uuid.uuid4())
    email = f"hakeem-smoke-{marker}@example.test"
    password = f"Smoke-{marker}-A9!"

    with SessionLocal() as db:
        try:
            password_hash = hash_password(password)
            user = User(id=user_id, email=email, password_hash=password_hash)
            db.add(user)
            db.commit()

            signup_persisted = db.scalar(select(User).where(User.id == user_id)) is not None
            password_verified = verify_password(password, password_hash)
            token = create_access_token(user_id)
            jwt_roundtrip = decode_access_token(token) == user_id

            profile = UserProfile(
                user_id=user_id,
                encrypted_name=encrypt_text("Hakeem Test User"),
                encrypted_age=encrypt_text("35"),
                encrypted_health_notes=encrypt_text("No known allergies."),
            )
            db.add(profile)
            db.commit()
            db.refresh(profile)

            profile_roundtrip = (
                decrypt_text(profile.encrypted_name) == "Hakeem Test User"
                and decrypt_text(profile.encrypted_age) == "35"
                and decrypt_text(profile.encrypted_health_notes) == "No known allergies."
            )

            session = ChatSession(
                id=session_id,
                user_id=user_id,
                title="Aspirin and warfarin interaction",
            )
            db.add(session)
            db.commit()

            question = "What is the interaction between aspirin and warfarin?"
            db.add(
                ChatMessage(
                    id=str(uuid.uuid4()),
                    session_id=session_id,
                    role="user",
                    content=question,
                )
            )
            db.commit()

            result = answer_question(db, question, [], profile)
            db.add(
                ChatMessage(
                    id=str(uuid.uuid4()),
                    session_id=session_id,
                    role="assistant",
                    content=result.answer,
                    citations_json=json.dumps(result.citations),
                )
            )
            session.updated_at = datetime.now(timezone.utc)
            db.add(session)
            db.commit()

            stored_messages = db.scalars(
                select(ChatMessage)
                .where(ChatMessage.session_id == session_id)
                .order_by(ChatMessage.created_at)
            ).all()

            chat_generated = bool(result.answer.strip())
            citations_generated = len(result.citations) > 0
            messages_persisted = len(stored_messages) == 2
            route_ok = result.route == "ddi_query"

            checks = {
                "signup_persisted": signup_persisted,
                "password_verified": password_verified,
                "jwt_roundtrip": jwt_roundtrip,
                "profile_encryption_roundtrip": profile_roundtrip,
                "chat_generated": chat_generated,
                "citations_generated": citations_generated,
                "messages_persisted": messages_persisted,
                "ddi_route": route_ok,
            }

            return {
                "status": "ok" if all(checks.values()) else "partial",
                "checks": checks,
                "chat": {
                    "route": result.route,
                    "citation_count": len(result.citations),
                    "stored_message_count": len(stored_messages),
                },
            }
        finally:
            db.rollback()
            db.execute(delete(ChatMessage).where(ChatMessage.session_id == session_id))
            db.execute(delete(ChatSession).where(ChatSession.id == session_id))
            db.execute(delete(UserProfile).where(UserProfile.user_id == user_id))
            db.execute(delete(User).where(User.id == user_id))
            db.commit()
