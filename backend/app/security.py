from __future__ import annotations

import base64
import hashlib
import secrets
from typing import Any

from fastapi import HTTPException, Request, Response, status
from itsdangerous import BadSignature, BadTimeSignature, URLSafeTimedSerializer

from .config import settings

COOKIE_NAME = "sauti_session"
COOKIE_MAX_AGE = 60 * 60 * 24 * 30

_session_serializer = URLSafeTimedSerializer(settings.session_secret, salt="app-session")
_playback_serializer = URLSafeTimedSerializer(settings.playback_secret, salt="playback-token")
PASSWORD_ITERATIONS = 310_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return "pbkdf2_sha256${iterations}${salt}${digest}".format(
        iterations=PASSWORD_ITERATIONS,
        salt=base64.urlsafe_b64encode(salt).decode("ascii"),
        digest=base64.urlsafe_b64encode(digest).decode("ascii"),
    )

def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, iterations_raw, salt_raw, digest_raw = password_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_raw)
        salt = base64.urlsafe_b64decode(salt_raw.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_raw.encode("ascii"))
    except (ValueError, TypeError):
        return False

    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return secrets.compare_digest(actual, expected)


def create_session_token(user_id: str) -> str:
    return _session_serializer.dumps({"user_id": str(user_id)})


def set_session_cookie(response: Response, user_id: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=create_session_token(user_id),
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


def read_session_payload(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    try:
        payload = _session_serializer.loads(token, max_age=COOKIE_MAX_AGE)
    except (BadSignature, BadTimeSignature):
        return None

    if not isinstance(payload, dict):
        return None
    return payload


def get_session_user_id(request: Request) -> str | None:
    payload = read_session_payload(request.cookies.get(COOKIE_NAME))
    if not payload:
        return None
    user_id = payload.get("user_id")
    return str(user_id) if user_id else None


def has_valid_session(request: Request) -> bool:
    return get_session_user_id(request) is not None


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
