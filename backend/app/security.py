from __future__ import annotations

import secrets
from typing import Any

from fastapi import HTTPException, Request, Response, status
from itsdangerous import BadSignature, BadTimeSignature, URLSafeTimedSerializer

from .config import settings

COOKIE_NAME = "sauti_session"
COOKIE_MAX_AGE = 60 * 60 * 24 * 30

_session_serializer = URLSafeTimedSerializer(settings.session_secret, salt="app-session")
_playback_serializer = URLSafeTimedSerializer(settings.playback_secret, salt="playback-token")


def verify_app_password(password: str) -> bool:
    return secrets.compare_digest(password, settings.app_password)


def create_session_token() -> str:
    return _session_serializer.dumps({"role": "user"})


def set_session_cookie(response: Response) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=create_session_token(),
        httponly=True,
        max_age=COOKIE_MAX_AGE,
        samesite="none" if settings.cookie_secure else "lax",
        secure=settings.cookie_secure,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=COOKIE_NAME,
        httponly=True,
        samesite="none" if settings.cookie_secure else "lax",
        secure=settings.cookie_secure,
        path="/",
    )


def has_valid_session(request: Request) -> bool:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return False
    try:
        _session_serializer.loads(token, max_age=COOKIE_MAX_AGE)
        return True
    except (BadSignature, BadTimeSignature):
        return False


def require_session(request: Request) -> None:
    if not has_valid_session(request):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="App login required")


def create_playback_token(track_id: str) -> str:
    return _playback_serializer.dumps({"track_id": str(track_id)})


def verify_playback_token(track_id: str, token: str | None) -> bool:
    if not token:
        return False
    try:
        payload: dict[str, Any] = _playback_serializer.loads(
            token,
            max_age=settings.playback_token_max_age,
        )
    except (BadSignature, BadTimeSignature):
        return False
    return str(payload.get("track_id")) == str(track_id)
