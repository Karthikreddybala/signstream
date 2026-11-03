from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    app_name: str = "SignStream API"
    environment: str = "development"
    secret_key: str = "change-this-secret-key-before-production"
    access_token_minutes: int = 30
    database_url: str = f"sqlite:///{(PROJECT_ROOT / 'backend' / 'signstream.db').as_posix()}"
    cors_origins: str = "http://localhost:5173,http://localhost:4173"
    motion_manifest_path: str = str(PROJECT_ROOT / "frontend" / "public" / "motion" / "manifest.json")
    upload_directory: str = str(PROJECT_ROOT / "backend" / "uploads")
    max_upload_bytes: int = 25 * 1024 * 1024
    max_recording_bytes: int = 100 * 1024 * 1024
    max_text_characters: int = 10_000
    llm_provider: str = "auto"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash-lite"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_transcription_model: str = "whisper-1"
    llm_timeout_seconds: float = 30.0
    llm_token_budget: int = 0

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
