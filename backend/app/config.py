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
    session_secret: str
    playback_secret: str
    cookie_secure: bool
    cors_origins: list[str]
    tidal_quality: str
    playback_token_max_age: int
    auth_invite_code: str | None
    auth_max_users: int
    r2_endpoint_url: str | None
    r2_access_key_id: str | None
    r2_secret_access_key: str | None
    r2_bucket_name: str | None
    r2_public_url: str | None


def get_settings() -> Settings:
    default_database_url = (
        "sqlite:////tmp/sauti-sounds.db"
        if os.getenv("VERCEL")
        else "sqlite:///./backend/dev.db"
    )
    database_url = _normalize_database_url(
        os.getenv("DATABASE_URL", default_database_url)
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
        session_secret=os.getenv("APP_SESSION_SECRET", "sauti-dev-session-secret"),
        playback_secret=os.getenv("PLAYBACK_TOKEN_SECRET", "sauti-dev-playback-secret"),
        cookie_secure=_parse_bool(os.getenv("COOKIE_SECURE"), False),
        cors_origins=cors_origins,
        tidal_quality=os.getenv("TIDAL_QUALITY", "HIGH"),
        playback_token_max_age=int(
            os.getenv("PLAYBACK_TOKEN_MAX_AGE", str(60 * 60 * 24 * 30))
        ),
        auth_invite_code=os.getenv("AUTH_INVITE_CODE") or None,
        auth_max_users=max(1, int(os.getenv("AUTH_MAX_USERS", "2"))),
        r2_endpoint_url=os.getenv("R2_ENDPOINT_URL") or None,
        r2_access_key_id=os.getenv("R2_ACCESS_KEY_ID") or None,
        r2_secret_access_key=os.getenv("R2_SECRET_ACCESS_KEY") or None,
        r2_bucket_name=os.getenv("R2_BUCKET_NAME") or None,
        r2_public_url=os.getenv("R2_PUBLIC_URL") or None,
    )


settings = get_settings()
