from __future__ import annotations

from collections.abc import Iterator
import json
from pathlib import Path
import time
import uuid

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .config import settings
from .database import (
    LibraryPlaylist,
    LibraryPlaylistFolder,
    LibraryTrack,
    UserAppStateSnapshot,
    User,
    get_db,
    init_db,
    migrate_db,
)
from .schemas import (
    AppStateSnapshotRequest,
    AuthLoginRequest,
    AuthRegisterRequest,
    LibrarySnapshotRequest,
    PlaylistAddItemsRequest,
    PlaylistCreateRequest,
)
from .security import (
    clear_session_cookie,
    get_session_user_id,
    has_valid_session,
    hash_password,
    require_session,
    set_session_cookie,
    verify_password,
    verify_playback_token,
)
from .r2_storage import (
    delete_object,
    generate_key,
    get_object_stream,
    get_presigned_url,
    is_configured as r2_is_configured,
    upload_fileobj,
)
from .tidal_service import tidal_manager

app = FastAPI(title="Sauti Sounds Backend", version="0.1.0")
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DIST_DIR = PROJECT_ROOT / "dist"
INDEX_FILE = DIST_DIR / "index.html"

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
    migrate_db()
    db = next(get_db())
    try:
        tidal_manager.load_from_db(db)
    finally:
        db.close()


def auth_required(request: Request) -> None:
    require_session(request)


def auth_user_id(request: Request) -> str:
    require_session(request)
    user_id = get_session_user_id(request)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="App login required"
        )
    return user_id


def playback_allowed(request: Request, track_id: str, token: str | None) -> None:
    if has_valid_session(request):
        return
    if verify_playback_token(track_id, token):
        return
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Stream access denied"
    )


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def normalize_email(email: str) -> str:
    normalized = email.strip().lower()
    if "@" not in normalized or "." not in normalized.split("@")[-1]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Enter a valid email address",
        )
    return normalized


def serialize_user(user: User) -> dict[str, str]:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
    }


def count_users(db: Session) -> int:
    return int(db.scalar(select(func.count()).select_from(User)) or 0)


def registration_open(db: Session) -> bool:
    return count_users(db) < settings.auth_max_users


def _deserialize_payloads(rows: list[LibraryTrack] | list[LibraryPlaylist] | list[LibraryPlaylistFolder]) -> list[dict]:
    return [json.loads(row.payload) for row in rows]


def _track_asset_keys(track: dict) -> list[str]:
    keys: list[str] = []
    r2_key = track.get("r2Key")
    artwork_r2_key = track.get("artworkR2Key")
    if isinstance(r2_key, str) and r2_key:
        keys.append(r2_key)
    if isinstance(artwork_r2_key, str) and artwork_r2_key:
        keys.append(artwork_r2_key)
    return keys


def _delete_r2_assets_for_removed_tracks(
    existing_tracks: list[LibraryTrack], next_tracks: list[dict]
) -> None:
    if not r2_is_configured():
        return

    next_ids = {
        str(track.get("id"))
        for track in next_tracks
        if isinstance(track, dict) and track.get("id") is not None
    }
    keys_to_delete: set[str] = set()
    for row in existing_tracks:
        payload = json.loads(row.payload)
        track_id = str(payload.get("id", ""))
        if track_id and track_id not in next_ids:
            keys_to_delete.update(_track_asset_keys(payload))

    for key in keys_to_delete:
        try:
            delete_object(key)
        except Exception:
            # Blob cleanup should not block library metadata writes.
            continue


def read_library_snapshot(db: Session, user_id: str) -> dict[str, list[dict]]:
    tracks = db.scalars(
        select(LibraryTrack)
        .where(LibraryTrack.user_id == user_id)
        .order_by(LibraryTrack.updated_at.desc())
    ).all()
    playlists = db.scalars(
        select(LibraryPlaylist)
        .where(LibraryPlaylist.user_id == user_id)
        .order_by(LibraryPlaylist.updated_at.desc())
    ).all()
    folders = db.scalars(
        select(LibraryPlaylistFolder)
        .where(LibraryPlaylistFolder.user_id == user_id)
        .order_by(LibraryPlaylistFolder.updated_at.desc())
    ).all()
    return {
        "tracks": _deserialize_payloads(tracks),
        "playlists": _deserialize_payloads(playlists),
        "folders": _deserialize_payloads(folders),
    }


def replace_library_snapshot(
    db: Session,
    user_id: str,
    payload: LibrarySnapshotRequest,
) -> dict[str, list[dict]]:
    now = int(time.time() * 1000)
    next_tracks = [track for track in payload.tracks if isinstance(track, dict) and track.get("id")]
    next_playlists = [playlist for playlist in payload.playlists if isinstance(playlist, dict) and playlist.get("id")]
    next_folders = [folder for folder in payload.folders if isinstance(folder, dict) and folder.get("id")]

    existing_tracks = db.scalars(
        select(LibraryTrack).where(LibraryTrack.user_id == user_id)
    ).all()
    _delete_r2_assets_for_removed_tracks(existing_tracks, next_tracks)

    db.execute(delete(LibraryTrack).where(LibraryTrack.user_id == user_id))
    db.execute(delete(LibraryPlaylist).where(LibraryPlaylist.user_id == user_id))
    db.execute(delete(LibraryPlaylistFolder).where(LibraryPlaylistFolder.user_id == user_id))

    db.add_all(
        [
            LibraryTrack(
                user_id=user_id,
                id=str(track["id"]),
                payload=json.dumps(track),
                updated_at=int(track.get("addedAt") or now),
            )
            for track in next_tracks
        ]
    )
    db.add_all(
        [
            LibraryPlaylist(
                user_id=user_id,
                id=str(playlist["id"]),
                payload=json.dumps(playlist),
                updated_at=int(playlist.get("updatedAt") or now),
            )
            for playlist in next_playlists
        ]
    )
    db.add_all(
        [
            LibraryPlaylistFolder(
                user_id=user_id,
                id=str(folder["id"]),
                payload=json.dumps(folder),
                updated_at=int(folder.get("updatedAt") or now),
            )
            for folder in next_folders
        ]
    )
    db.commit()
    return {
        "tracks": next_tracks,
        "playlists": next_playlists,
        "folders": next_folders,
    }


def clear_library_snapshot(db: Session, user_id: str) -> None:
    if r2_is_configured():
        existing_tracks = db.scalars(
            select(LibraryTrack).where(LibraryTrack.user_id == user_id)
        ).all()
        for row in existing_tracks:
            payload = json.loads(row.payload)
            for key in _track_asset_keys(payload):
                try:
                    delete_object(key)
                except Exception:
                    continue

    db.execute(delete(LibraryTrack).where(LibraryTrack.user_id == user_id))
    db.execute(delete(LibraryPlaylist).where(LibraryPlaylist.user_id == user_id))
    db.execute(delete(LibraryPlaylistFolder).where(LibraryPlaylistFolder.user_id == user_id))
    db.commit()


def read_app_state_snapshot(db: Session, user_id: str) -> dict:
    snapshot = db.get(UserAppStateSnapshot, user_id)
    if snapshot is None:
        return {
            "notifications": [],
            "history": [],
            "listenEvents": [],
            "mixes": [],
            "tasteProfile": None,
            "settings": {},
            "ui": {},
        }
    payload = json.loads(snapshot.payload)
    return {
        "notifications": payload.get("notifications", []),
        "history": payload.get("history", []),
        "listenEvents": payload.get("listenEvents", []),
        "mixes": payload.get("mixes", []),
        "tasteProfile": payload.get("tasteProfile"),
        "settings": payload.get("settings", {}),
        "ui": payload.get("ui", {}),
    }


def replace_app_state_snapshot(
    db: Session,
    user_id: str,
    payload: AppStateSnapshotRequest,
) -> dict:
    now = int(time.time() * 1000)
    snapshot = db.get(UserAppStateSnapshot, user_id)
    value = {
        "notifications": payload.notifications,
        "history": payload.history,
        "listenEvents": payload.listen_events,
        "mixes": payload.mixes,
        "tasteProfile": payload.taste_profile,
        "settings": payload.settings,
        "ui": payload.ui,
    }
    encoded = json.dumps(value)
    if snapshot is None:
        snapshot = UserAppStateSnapshot(user_id=user_id, payload=encoded, updated_at=now)
        db.add(snapshot)
    else:
        snapshot.payload = encoded
        snapshot.updated_at = now
    db.commit()
    return value


def build_auth_session_payload(
    db: Session,
    request: Request,
    *,
    user: User | None = None,
) -> dict:
    session_user = user
    if session_user is None:
        user_id = get_session_user_id(request)
        session_user = db.get(User, user_id) if user_id else None

    user_count = count_users(db)
    return {
        "authenticated": session_user is not None,
        "user": serialize_user(session_user) if session_user else None,
        "canRegister": user_count < settings.auth_max_users,
        "userCount": user_count,
        "maxUsers": settings.auth_max_users,
        "requiresInviteCode": bool(settings.auth_invite_code),
    }


@app.get("/api/auth/session")
def auth_session(request: Request, db: Session = Depends(get_db)) -> dict:
    return build_auth_session_payload(db, request)


@app.post("/api/auth/login")
def auth_login(
    payload: AuthLoginRequest,
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    email = normalize_email(payload.email)
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
        )

    set_session_cookie(response, user.id)
    return build_auth_session_payload(db, request, user=user)


@app.post("/api/auth/register")
def auth_register(
    payload: AuthRegisterRequest,
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    if not registration_open(db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Registration is closed"
        )

    if settings.auth_invite_code and payload.invite_code != settings.auth_invite_code:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Invalid invite code"
        )

    email = normalize_email(payload.email)
    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That email is already registered",
        )

    name = payload.name.strip() or email.split("@", 1)[0]
    user = User(
        id=str(uuid.uuid4()),
        email=email,
        name=name,
        password_hash=hash_password(payload.password),
        created_at=int(time.time() * 1000),
    )
    db.add(user)
    db.commit()

    set_session_cookie(response, user.id)
    return build_auth_session_payload(db, request, user=user)


@app.post("/api/auth/logout")
def auth_logout(response: Response, db: Session = Depends(get_db)) -> dict:
    clear_session_cookie(response)
    return {
        "authenticated": False,
        "user": None,
        "canRegister": registration_open(db),
        "userCount": count_users(db),
        "maxUsers": settings.auth_max_users,
        "requiresInviteCode": bool(settings.auth_invite_code),
    }


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
        "verificationUri": tidal_manager.normalize_external_url(
            attempt.login.verification_uri
        ),
        "verificationUriComplete": tidal_manager.normalize_external_url(
            attempt.login.verification_uri_complete
        ),
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


@app.get("/api/storage/status")
def storage_status(request: Request) -> dict:
    auth_required(request)
    return {"r2Configured": r2_is_configured()}


@app.post("/api/storage/upload")
async def storage_upload(request: Request) -> dict:
    auth_required(request)
    if not r2_is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="R2 storage is not configured",
        )

    content_type = request.headers.get("Content-Type", "")
    if not content_type.startswith("multipart/form-data"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Expected multipart/form-data",
        )

    form = await request.form()
    file = form.get("file")
    if file is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No file provided"
        )

    filename = file.filename or "upload"
    key = generate_key(filename)
    content_type_value = file.content_type or "application/octet-stream"

    upload_fileobj(key, file.file, content_type_value)

    presigned = get_presigned_url(key)
    return {"key": key, "url": presigned}


@app.get("/api/storage/{key:path}/url")
def storage_get_url(key: str, request: Request) -> dict:
    auth_required(request)
    url = get_presigned_url(key)
    if url is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Object not found or R2 not configured",
        )
    return {"key": key, "url": url}


@app.get("/api/storage/{key:path}/stream")
def storage_stream(key: str, request: Request) -> StreamingResponse:
    auth_required(request)
    if not r2_is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="R2 storage is not configured",
        )

    try:
        obj = get_object_stream(key)
    except Exception:
        obj = None

    if obj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Object not found or R2 not configured",
        )

    body = obj["Body"]

    def content() -> Iterator[bytes]:
        try:
            for chunk in iter(lambda: body.read(64 * 1024), b""):
                if chunk:
                    yield chunk
        finally:
            body.close()

    headers: dict[str, str] = {}
    if obj.get("ContentLength"):
        headers["Content-Length"] = str(obj["ContentLength"])
    if obj.get("ContentType"):
        headers["Content-Type"] = str(obj["ContentType"])

    return StreamingResponse(content(), headers=headers)


@app.delete("/api/storage/{key:path}")
def storage_delete(key: str, request: Request) -> dict:
    auth_required(request)
    if not r2_is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="R2 storage is not configured",
        )
    delete_object(key)
    return {"ok": True}


@app.get("/api/library/snapshot")
def library_snapshot(request: Request, db: Session = Depends(get_db)) -> dict:
    user_id = auth_user_id(request)
    return read_library_snapshot(db, user_id)


@app.put("/api/library/snapshot")
def library_snapshot_replace(
    payload: LibrarySnapshotRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    user_id = auth_user_id(request)
    return replace_library_snapshot(db, user_id, payload)


@app.delete("/api/library/snapshot")
def library_snapshot_clear(request: Request, db: Session = Depends(get_db)) -> dict[str, bool]:
    user_id = auth_user_id(request)
    clear_library_snapshot(db, user_id)
    return {"ok": True}


@app.get("/api/state/snapshot")
def app_state_snapshot(request: Request, db: Session = Depends(get_db)) -> dict:
    user_id = auth_user_id(request)
    return read_app_state_snapshot(db, user_id)


@app.put("/api/state/snapshot")
def app_state_snapshot_replace(
    payload: AppStateSnapshotRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    user_id = auth_user_id(request)
    return replace_app_state_snapshot(db, user_id, payload)


@app.exception_handler(ValueError)
def value_error_handler(_request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST, content={"detail": str(exc)}
    )


@app.get("/{full_path:path}", include_in_schema=False)
def serve_spa(full_path: str) -> FileResponse:
    if full_path == "api" or full_path.startswith("api/"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    if full_path:
        candidate = (DIST_DIR / full_path).resolve()
        try:
            candidate.relative_to(DIST_DIR.resolve())
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Not found"
            ) from exc

        if candidate.is_file():
            return FileResponse(candidate)

    if INDEX_FILE.is_file():
        return FileResponse(INDEX_FILE)

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Frontend bundle not found. Build the app before serving it.",
    )
