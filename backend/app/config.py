from __future__ import annotations

import os
from dataclasses import dataclass


def _parse_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def _normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


@dataclass(frozen=True)
class Settings:
    database_url: str
    app_password: str
    session_secret: str
    playback_secret: str
    cookie_secure: bool
    cors_origins: list[str]
    tidal_quality: str
    playback_token_max_age: int


def get_settings() -> Settings:
    database_url = _normalize_database_url(
        os.getenv("DATABASE_URL", "sqlite:///./backend/dev.db")
    )
    cors_origins = [
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174",
        ).split(",")
        if origin.strip()
    ]

    return Settings(
        database_url=database_url,
        app_password=os.getenv("APP_PASSWORD", "changeme"),
        session_secret=os.getenv("APP_SESSION_SECRET", "sauti-dev-session-secret"),
        playback_secret=os.getenv("PLAYBACK_TOKEN_SECRET", "sauti-dev-playback-secret"),
        cookie_secure=_parse_bool(os.getenv("COOKIE_SECURE"), False),
        cors_origins=cors_origins,
        tidal_quality=os.getenv("TIDAL_QUALITY", "HIGH"),
        playback_token_max_age=int(os.getenv("PLAYBACK_TOKEN_MAX_AGE", str(60 * 60 * 24 * 30))),
    )


settings = get_settings()
