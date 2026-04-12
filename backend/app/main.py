from __future__ import annotations

from collections.abc import Iterator

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db, init_db
from .schemas import AppLoginRequest, PlaylistAddItemsRequest, PlaylistCreateRequest
from .security import (
    clear_session_cookie,
    has_valid_session,
    require_session,
    set_session_cookie,
    verify_app_password,
    verify_playback_token,
)
from .tidal_service import tidal_manager

app = FastAPI(title="Sauti Sounds Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()
    db = next(get_db())
    try:
        tidal_manager.load_from_db(db)
    finally:
        db.close()


def auth_required(request: Request) -> None:
    require_session(request)


def playback_allowed(request: Request, track_id: str, token: str | None) -> None:
    if has_valid_session(request):
        return
    if verify_playback_token(track_id, token):
        return
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Stream access denied")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/app/session")
def app_session(request: Request) -> dict[str, bool]:
    return {"authenticated": has_valid_session(request)}


@app.post("/api/app/login")
def app_login(payload: AppLoginRequest, response: Response) -> dict[str, bool]:
    if not verify_app_password(payload.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")
    set_session_cookie(response)
    return {"authenticated": True}


@app.post("/api/app/logout")
def app_logout(response: Response) -> dict[str, bool]:
    clear_session_cookie(response)
    return {"authenticated": False}


@app.get("/api/tidal/session")
def tidal_session(request: Request) -> dict:
    auth_required(request)
    tidal_manager.cleanup_attempts()
    session = tidal_manager.get_session()
    connected = bool(session and session.check_login())
    return {
        "connected": connected,
        "user": tidal_manager.serialize_user(session.user) if connected else None,
    }


@app.post("/api/tidal/login/start")
def tidal_login_start(request: Request) -> dict:
    auth_required(request)
    attempt = tidal_manager.start_login()
    return {
        "attemptId": attempt.attempt_id,
        "verificationUri": tidal_manager.normalize_external_url(attempt.login.verification_uri),
        "verificationUriComplete": tidal_manager.normalize_external_url(attempt.login.verification_uri_complete),
        "expiresIn": attempt.login.expires_in,
        "interval": attempt.login.interval,
    }


@app.get("/api/tidal/login/status/{attempt_id}")
def tidal_login_status(
    attempt_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    auth_required(request)
    return tidal_manager.resolve_attempt(db, attempt_id)


@app.post("/api/tidal/logout")
def tidal_logout(
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    auth_required(request)
    tidal_manager.clear(db)
    return {"connected": False}


@app.get("/api/tidal/search")
def tidal_search(
    request: Request,
    q: str,
    limit: int = 20,
) -> dict:
    auth_required(request)
    tracks = tidal_manager.search_tracks(q, limit)
    return {"tracks": tracks, "totalResults": len(tracks)}


@app.get("/api/tidal/tracks/{track_id}")
def tidal_track(
    track_id: str,
    request: Request,
) -> dict:
    auth_required(request)
    return tidal_manager.get_track(track_id)


@app.get("/api/tidal/favorites/tracks")
def tidal_favorite_tracks(
    request: Request,
) -> dict:
    auth_required(request)
    return {"tracks": tidal_manager.get_favorite_tracks()}


@app.post("/api/tidal/favorites/tracks/{track_id}")
def tidal_add_favorite(
    track_id: str,
    request: Request,
) -> dict[str, bool]:
    auth_required(request)
    return {"ok": tidal_manager.add_favorite_track(track_id)}


@app.delete("/api/tidal/favorites/tracks/{track_id}")
def tidal_remove_favorite(
    track_id: str,
    request: Request,
) -> dict[str, bool]:
    auth_required(request)
    return {"ok": tidal_manager.remove_favorite_track(track_id)}


@app.get("/api/tidal/playlists")
def tidal_playlists(
    request: Request,
) -> dict:
    auth_required(request)
    return {"playlists": tidal_manager.get_playlists()}


@app.post("/api/tidal/playlists")
def tidal_create_playlist(
    payload: PlaylistCreateRequest,
    request: Request,
) -> dict:
    auth_required(request)
    return tidal_manager.create_playlist(payload.name, payload.description)


@app.get("/api/tidal/playlists/{playlist_id}")
def tidal_playlist(
    playlist_id: str,
    request: Request,
) -> dict:
    auth_required(request)
    return tidal_manager.get_playlist(playlist_id)


@app.post("/api/tidal/playlists/{playlist_id}/items")
def tidal_playlist_add_items(
    playlist_id: str,
    payload: PlaylistAddItemsRequest,
    request: Request,
) -> dict:
    auth_required(request)
    return tidal_manager.add_playlist_items(playlist_id, payload.track_ids)


@app.delete("/api/tidal/playlists/{playlist_id}/items/{item_id}")
def tidal_playlist_remove_item(
    playlist_id: str,
    item_id: str,
    request: Request,
) -> dict:
    auth_required(request)
    return tidal_manager.remove_playlist_item(playlist_id, item_id)


@app.get("/api/tidal/tracks/{track_id}/stream")
def tidal_track_stream(
    track_id: str,
    request: Request,
    token: str | None = None,
) -> StreamingResponse:
    playback_allowed(request, track_id, token)

    upstream, headers = tidal_manager.get_stream_response(
        track_id,
        request.headers.get("Range"),
    )
    status_code = upstream.status_code

    def content() -> Iterator[bytes]:
        try:
            for chunk in upstream.iter_content(chunk_size=64 * 1024):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    return StreamingResponse(content(), status_code=status_code, headers=headers)


@app.exception_handler(ValueError)
def value_error_handler(_request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"detail": str(exc)})
