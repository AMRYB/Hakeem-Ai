from __future__ import annotations

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
    )

    app_env: str = "development"
    app_name: str = "Grounded DDI Assistant"
    secret_key: str = "change-me"
    jwt_expire_minutes: int = 1440
    profile_encryption_key: str = ""
    allowed_origins: str = "http://localhost:3000"

    database_url: str = "sqlite:///./ddi_app.db"
    postgres_url: str = ""
    knowledge_database_url: str = "sqlite:///./ddi_app.db"
    rag_store: str = "auto"
    chroma_dir: str = "./chroma_db"
    dense_top_k: int = 20
    sparse_top_k: int = 20
    final_top_k: int = 8
    reranker_enabled: bool = True
    reranker_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    reranker_threshold: float = 0.15

    embedding_provider: str = "sentence_transformers"
    embedding_model: str = "pritamdeka/S-PubMedBert-MS-MARCO"
    embedding_batch_size: int = 32

    llm_provider: str = "ollama"
    ollama_base_url: str = "http://localhost:11434"
    ollama_api_key: str = ""
    ollama_model: str = "qwen2.5:latest"

    groq_api_base: str = "https://api.groq.com/openai/v1"
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-20b"

    openai_api_base: str = "https://api.openai.com/v1"
    openai_api_key: str = ""
    openai_model: str = "gpt-5.4-mini"
    openai_embedding_model: str = "text-embedding-3-small"

    llm_temperature: float = 0.0
    llm_timeout_seconds: int = 120

    fda_api_base: str = "https://api.fda.gov"
    fda_api_key: str = ""
    fda_timeout_seconds: int = 15

    eda_monographs_csv: str = "./data/egypt/eda_all_drug_monographs.csv"
    eda_monographs_cleaned_csv: str = "./data/egypt/eda_all_drug_monographs_cleaned.csv"
    drug_aliases_csv: str = "./data/aliases/drug_aliases.csv"
    ddinter_glob: str = "./data/ddinter/ddinter_downloads_code_*.csv"
    formulary_dir: str = "./data/formulary"
    safety_patterns_file: str = "./config/safety_patterns.json"

    login_rate_limit_per_minute: int = 10
    chat_rate_limit_per_minute: int = 30

    @property
    def resolved_database_url(self) -> str:
        if self.database_url != "sqlite:///./ddi_app.db":
            return self.database_url
        if self.postgres_url:
            return self.postgres_url
        return self.database_url

    @property
    def is_postgres(self) -> bool:
        value = self.resolved_database_url
        return value.startswith("postgresql") or value.startswith("postgres")

    @property
    def is_knowledge_postgres(self) -> bool:
        return self.knowledge_database_url.startswith("postgresql") or self.knowledge_database_url.startswith("postgres")

    @property
    def resolved_rag_store(self) -> str:
        if self.rag_store != "auto":
            return self.rag_store
        return "pgvector" if self.is_knowledge_postgres else "chroma"

    @property
    def origins(self) -> list[str]:
        return [x.strip() for x in self.allowed_origins.split(",") if x.strip()]

    def validate_secrets(self) -> None:
        if self.app_env.lower() == "production" and self.secret_key == "change-me":
            raise RuntimeError("SECRET_KEY must be changed in production")
        if self.app_env.lower() == "production" and not self.profile_encryption_key:
            raise RuntimeError("PROFILE_ENCRYPTION_KEY must be set in production")
        if self.app_env.lower() == "production" and self.llm_provider == "groq" and not self.groq_api_key:
            raise RuntimeError("GROQ_API_KEY must be set when LLM_PROVIDER=groq in production")
        if self.app_env.lower() == "production" and self.llm_provider == "openai" and not self.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY must be set when LLM_PROVIDER=openai in production")
        if self.app_env.lower() == "production" and self.embedding_provider == "openai" and not self.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY must be set when EMBEDDING_PROVIDER=openai in production")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.validate_secrets()
    return settings
