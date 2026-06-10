"""Application settings loaded from environment (12-factor)."""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str = "postgresql+psycopg://aisplit:aisplit_dev_pw@localhost:5432/aisplit"

    # Redis / Celery
    redis_url: str = "redis://localhost:6379/0"

    # Storage (S3 / MinIO)
    s3_endpoint_url: str = "http://localhost:9000"
    s3_public_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "aisplit"
    s3_secret_key: str = "aisplit_dev_pw"
    s3_bucket: str = "aisplit"
    s3_region: str = "us-east-1"

    # Auth
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 10080

    # Audio processing
    # Separation backend: "htdemucs_6s" (6 stems incl. guitar/piano, slow on CPU),
    # "htdemucs" (4 stems), or "stub" (fast DSP approximation, no ML deps).
    separation_model: str = "htdemucs_6s"
    # Test-time augmentation passes — higher = cleaner separation but linearly
    # slower (each shift re-runs the model). 0 = fastest, 1–2 = noticeably cleaner.
    separation_shifts: int = 1
    # Split/relabel raw separator output into finer worship stems
    # (Lead Vocal/BGV, Kick/Drums, Electric, Keys, Synth/Pad).
    refine_stems: bool = True
    # The click is synthesized client-side now; kept for older callers/tests.
    generate_click: bool = True

    # App
    cors_origins: str = "http://localhost:3000"
    log_level: str = "INFO"
    max_upload_bytes: int = 1_073_741_824  # 1 GB

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
